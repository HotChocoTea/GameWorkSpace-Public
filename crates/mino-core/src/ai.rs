use crate::{
    repo::{get, now, put, query},
    *,
};
use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use uuid::Uuid;

mod proposals;
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    OpenaiCompat,
    Anthropic,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningTier {
    Fast,
    Standard,
    Ultra,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub base_url: String,
    pub model: String,
    pub models: Vec<String>,
    pub reasoning_tier: ReasoningTier,
    pub requires_key: bool,
}
pub fn providers() -> Vec<AiProviderConfig> {
    [
        (
            "openai",
            "OpenAI",
            "https://api.openai.com/v1",
            &["gpt-4.1", "gpt-4.1-mini", "o4-mini"][..],
        ),
        (
            "deepseek",
            "DeepSeek",
            "https://api.deepseek.com/v1",
            &["deepseek-chat", "deepseek-reasoner"],
        ),
        (
            "qwen",
            "通义千问",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            &["qwen-plus", "qwen-max", "qwen-turbo"],
        ),
        (
            "moonshot",
            "月之暗面 Kimi",
            "https://api.moonshot.cn/v1",
            &["moonshot-v1-8k", "moonshot-v1-32k"],
        ),
        (
            "zhipu",
            "智谱 GLM",
            "https://open.bigmodel.cn/api/paas/v4",
            &["glm-4-plus", "glm-4-air"],
        ),
        (
            "anthropic",
            "Anthropic Claude",
            "https://api.anthropic.com/v1",
            &["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest"],
        ),
        (
            "ollama",
            "本地 Ollama / LM Studio",
            "http://127.0.0.1:11434/v1",
            &["qwen2.5:14b", "llama3.1"],
        ),
        ("custom", "自定义 OpenAI 兼容", "", &[]),
    ]
    .into_iter()
    .map(|(id, name, url, models)| AiProviderConfig {
        id: id.into(),
        name: name.into(),
        protocol: if id == "anthropic" {
            Protocol::Anthropic
        } else {
            Protocol::OpenaiCompat
        },
        base_url: url.into(),
        model: models.first().unwrap_or(&"").to_string(),
        models: models.iter().map(|s| s.to_string()).collect(),
        reasoning_tier: ReasoningTier::Standard,
        requires_key: id != "ollama",
    })
    .collect()
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Ask,
    Review,
    Auto,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRequest {
    pub project_id: String,
    pub module: String,
    pub focused_id: Option<String>,
    pub prompt: String,
    pub config: AiProviderConfig,
    pub mode: Mode,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Attachment {
    Text {
        name: String,
        text: String,
    },
    Image {
        name: String,
        mime: String,
        base64: String,
    },
}
#[derive(Clone, Copy)]
pub(crate) enum ResponseFormat {
    Stream,
    Proposals,
    Json,
}
pub const DEFAULT_SYSTEM: &str = "你是游戏设计项目的创作助手。用中文回答，引用项目中已有的条目。";
const PROPOSAL_FORMAT: &str = r#"只返回一个 JSON 对象 {"reply":"给用户的说明","operations":[]}。operation 为 create_entity（entityType,title,subtitle,summary,status,tags,body,data），update_entity（targetEntityId,patch 部分字段），delete_entity（targetEntityId），或 create_link（sourceId,targetId,relationLabel）。每项含 operation 字段。使用上下文中的真实 ID，没有变更就返回空数组。"#;
fn invalid(message: &str) -> Error {
    Error::Invalid(message.into())
}
fn limited(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

impl Database {
    fn ai_context(
        &self,
        project: &str,
        module: &str,
        focused: Option<&str>,
        prompt: &str,
    ) -> Result<Value> {
        let p = self.get_project(project)?;
        let (focus, catalog, mentions) = {
            let conn = self.conn()?;
            let focus = focused
                .map(|id| get::<Entity>(&conn, id))
                .transpose()?
                .filter(|e| e.project_id == project && e.deleted_at.is_none());
            let mut catalog = json!({});
            let mut titles=conn.prepare("SELECT id,substr(title,1,80) FROM entities WHERE project_id=?1 AND entity_type=?2 AND deleted_at IS NULL ORDER BY sort_order,title LIMIT 12")?;
            for kind in ["character", "location", "quest", "task"] {
                let count:i64=conn.query_row("SELECT count(*) FROM entities WHERE project_id=?1 AND entity_type=?2 AND deleted_at IS NULL",[project,kind],|r|r.get(0))?;
                let entries = titles
                    .query_map([project, kind], |r| {
                        Ok(json!([r.get::<_, String>(0)?, r.get::<_, String>(1)?]))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                catalog[kind] = json!({"count":count,"entries":entries});
            }
            let mut find=conn.prepare("SELECT title FROM entities WHERE project_id=?1 AND deleted_at IS NULL AND instr(lower(?2),lower(title))>0 ORDER BY length(title) DESC LIMIT 6")?;
            let mentions = find
                .query_map([project, prompt], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            (focus, catalog, mentions)
        };
        let mut hits = Vec::new();
        for term in mentions
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(prompt))
            .chain(prompt.split_whitespace())
            .take(12)
        {
            for hit in self.search_entities(project, &limited(term, 256), 6)? {
                if !hits.iter().any(|h: &SearchResult| h.id == hit.id) && hits.len() < 8 {
                    hits.push(SearchResult {
                        title: limited(&hit.title, 100),
                        summary: limited(&hit.summary, 300),
                        ..hit
                    });
                }
            }
        }
        Ok(
            json!({"project":{"id":p.id,"name":p.name,"pitch":limited(&p.pitch,1200),"engine":p.engine,"genres":p.genres,"platforms":p.platforms},"module":module,"catalog":catalog,"search":hits,"focus":focus}),
        )
    }
    pub fn list_ai_messages(&self, project: &str) -> Result<Vec<AiMessage>> {
        query(
            &*self.conn()?,
            "WHERE project_id=? ORDER BY created_at,rowid",
            [project],
        )
    }
    pub fn list_ai_proposals(&self, project: &str) -> Result<Vec<AiProposal>> {
        query(
            &*self.conn()?,
            "WHERE project_id=? ORDER BY created_at,rowid",
            [project],
        )
    }
    pub fn clear_ai_session(&self, project: &str) -> Result<()> {
        self.write(|c| {
            c.execute("DELETE FROM ai_messages WHERE project_id=?", [project])?;
            c.execute(
                "UPDATE ai_proposals SET status='rejected' WHERE project_id=? AND status='pending'",
                [project],
            )?;
            Ok(())
        })
    }
    fn request(
        &self,
        config: &AiProviderConfig,
        path: &str,
        timeout: u64,
        key: Option<&str>,
    ) -> Result<RequestBuilder> {
        let base =
            reqwest::Url::parse(&config.base_url).map_err(|_| invalid("请填写有效的 Base URL"))?;
        if !matches!(base.scheme(), "http" | "https")
            || base.query().is_some()
            || base.fragment().is_some()
            || !base.username().is_empty()
            || base.password().is_some()
        {
            return Err(invalid("Base URL 仅支持 HTTP(S) 服务地址"));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| invalid("无法初始化网络连接"))?;
        let url = format!("{}/{}", base.as_str().trim_end_matches('/'), path);
        let mut req = if path == "models" {
            client.get(url)
        } else {
            client.post(url)
        };
        if config.protocol == Protocol::Anthropic {
            req = req.header("anthropic-version", "2023-06-01");
        }
        match key {
            Some(key) => Ok(if config.protocol == Protocol::Anthropic {
                req.header("x-api-key", key)
            } else {
                req.bearer_auth(key)
            }),
            None if config.requires_key => Err(invalid("请先保存此服务的 API Key")),
            None => Ok(req),
        }
    }
    pub async fn test_connection(&self, config: &AiProviderConfig) -> ConnectionTest {
        let start = Instant::now();
        let result = async {
            let key = self.get_api_key(&config.id)?;
            check_response(transmit(self.request(config, "models", 15, key.as_deref())?).await?)?;
            Ok::<(), Error>(())
        }
        .await;
        ConnectionTest {
            ok: result.is_ok(),
            latency_ms: start.elapsed().as_millis() as u64,
            message: result
                .err()
                .map_or_else(|| "连接成功".to_string(), |e| e.to_string()),
        }
    }
    pub(crate) async fn completion(
        &self,
        config: &AiProviderConfig,
        system: &str,
        mut messages: Vec<Value>,
        format: ResponseFormat,
        mut delta: impl FnMut(&str),
    ) -> Result<String> {
        let stream = matches!(format, ResponseFormat::Stream);
        let anthropic = config.protocol == Protocol::Anthropic;
        let path = if anthropic {
            "messages"
        } else {
            "chat/completions"
        };
        let mut system = system.to_string();
        system.push_str(match config.reasoning_tier {
            ReasoningTier::Fast => "\n简明回答。",
            ReasoningTier::Standard => "\n按需解释。",
            ReasoningTier::Ultra => "\n仔细检查约束、依赖和一致性。",
        });
        let mut body = if anthropic {
            json!({"model":config.model,"system":system,"messages":messages,"max_tokens":8192,"stream":stream})
        } else {
            messages.insert(0, json!({"role":"system","content":system}));
            json!({"model":config.model,"messages":messages,"stream":stream})
        };
        if matches!(format, ResponseFormat::Proposals)
            && matches!(config.id.as_str(), "openai" | "anthropic")
        {
            let schema = json!({"type":"object","properties":{"reply":{"type":"string"},"operations":{"type":"array","items":{"type":"object","properties":{"operation":{"type":"string","enum":["create_entity","update_entity","delete_entity","create_link"]}},"required":["operation"]}}},"required":["reply","operations"]});
            let name = "propose_changes";
            if anthropic {
                body["tools"] = json!([{"name":name,"description":"提交项目变更供工作区处理","input_schema":schema}]);
                body["tool_choice"] = json!({"type":"tool","name":name});
            } else {
                body["tools"] = json!([{"type":"function","function":{"name":name,"description":"提交项目变更供工作区处理","parameters":schema}}]);
                body["tool_choice"] = json!({"type":"function","function":{"name":name}});
            }
        }
        let key = self.get_api_key(&config.id)?;
        if let Some(secret) = key.as_deref() {
            if includes_secret(&body, secret) {
                return Err(invalid("请求内容包含已配置的 API Key，请移除密钥后重试"));
            }
        }
        let mut response =
            transmit(self.request(config, path, 120, key.as_deref())?.json(&body)).await?;
        if body.get("tools").is_some() && matches!(response.status().as_u16(), 400 | 422) {
            if let Some(fields) = body.as_object_mut() {
                fields.remove("tools");
                fields.remove("tool_choice");
            }
            response =
                transmit(self.request(config, path, 120, key.as_deref())?.json(&body)).await?;
        }
        let response = check_response(response)?;
        let sse = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.contains("text/event-stream"));
        if !sse {
            let value: Value = response
                .json()
                .await
                .map_err(|_| invalid("服务响应不是有效 JSON"))?;
            if key
                .as_deref()
                .is_some_and(|secret| includes_secret(&value, secret))
            {
                return Err(invalid("服务响应包含 API Key，已中止生成"));
            }
            if matches!(format, ResponseFormat::Proposals) {
                if let Some(block) = value["content"].as_array().and_then(|blocks| {
                    blocks
                        .iter()
                        .find(|b| b["type"] == "tool_use" && b["name"] == "propose_changes")
                }) {
                    return Ok(block["input"].to_string());
                }
                if let Some(call) = value
                    .pointer("/choices/0/message/tool_calls")
                    .and_then(Value::as_array)
                    .and_then(|calls| {
                        calls
                            .iter()
                            .find(|c| c["function"]["name"] == "propose_changes")
                    })
                {
                    return call
                        .pointer("/function/arguments")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .ok_or_else(|| invalid("缺少工具参数"));
                }
            }
            let text = if anthropic {
                value["content"].as_array().map(|blocks| {
                    blocks
                        .iter()
                        .filter_map(|v| v["text"].as_str())
                        .collect::<String>()
                })
            } else {
                value
                    .pointer("/choices/0/message/content")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }
            .filter(|s| !s.is_empty())
            .ok_or_else(|| invalid("服务未返回回答"))?;
            if key.as_deref().is_some_and(|secret| text.contains(secret)) {
                return Err(invalid("服务响应包含 API Key，已中止生成"));
            }
            delta(&text);
            return Ok(text);
        }
        let mut bytes = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut answer = String::new();
        let mut done = false;
        let mut emitted = 0;
        while let Some(chunk) = bytes.next().await {
            buffer.extend(chunk.map_err(|_| invalid("流式响应中断"))?);
            let mut offset = 0;
            while let Some(end) = buffer[offset..].iter().position(|&b| b == b'\n') {
                let line = std::str::from_utf8(&buffer[offset..offset + end])
                    .map_err(|_| invalid("无效的 UTF-8 响应"))?
                    .trim();
                offset += end + 1;
                if let Some(data) = line.strip_prefix("data:").map(str::trim) {
                    if data == "[DONE]" {
                        done = true;
                        break;
                    }
                    let event: Value = serde_json::from_str(data)?;
                    if event.get("error").is_some() {
                        return Err(invalid("服务报告流式生成失败"));
                    }
                    if event["type"] == "message_stop" {
                        done = true;
                        break;
                    }
                    if let Some(part) = event
                        .pointer(if anthropic {
                            "/delta/text"
                        } else {
                            "/choices/0/delta/content"
                        })
                        .and_then(Value::as_str)
                    {
                        answer.push_str(part);
                        let pending = &answer[emitted..];
                        let end = if let Some(secret) = key.as_deref() {
                            if pending.contains(secret) {
                                return Err(invalid("服务响应包含 API Key，已中止生成"));
                            }
                            // A credential can span two SSE frames. Hold any possible prefix.
                            let tail = secret
                                .char_indices()
                                .map(|(i, _)| i)
                                .rev()
                                .find(|n| pending.ends_with(&secret[..*n]))
                                .unwrap_or(0);
                            pending.len() - tail
                        } else {
                            pending.len()
                        };
                        if end > 0 {
                            delta(&pending[..end]);
                            emitted += end
                        }
                    }
                }
            }
            buffer.drain(..offset);
            if done {
                break;
            }
        }
        if !done || answer.is_empty() {
            return Err(invalid("流式响应未完整结束"));
        }
        if emitted < answer.len() {
            delta(&answer[emitted..])
        }
        Ok(answer)
    }
    pub async fn ai_chat_send(
        &self,
        r: &ChatRequest,
        delta: impl FnMut(&str),
    ) -> Result<AiMessage> {
        if r.prompt.trim().is_empty() {
            return Err(invalid("请输入问题"));
        }
        let context =
            self.ai_context(&r.project_id, &r.module, r.focused_id.as_deref(), &r.prompt)?;
        let custom = self
            .get_setting("ai.system")?
            .and_then(|s| s.value.as_str().map(str::to_owned))
            .unwrap_or_else(|| DEFAULT_SYSTEM.into());
        let context = bounded_context(context);
        let system = format!(
            "{}\n项目资料：{}\n{}",
            custom,
            context,
            if r.mode == Mode::Ask {
                "仅回答问题。"
            } else {
                PROPOSAL_FORMAT
            }
        );
        let history = self.list_ai_messages(&r.project_id)?;
        let mut messages: Vec<_> = history
            .iter()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|m| json!({"role":m.role,"content":limited(&m.content,1800)}))
            .collect();
        let mut content = vec![json!({"type":"text","text":r.prompt})];
        for attachment in &r.attachments {
            content.push(match attachment {
                Attachment::Text{name,text}=>json!({"type":"text","text":format!("{name}\n{text}")}),
                Attachment::Image{mime,base64,..} if r.config.protocol==Protocol::Anthropic=>json!({"type":"image","source":{"type":"base64","media_type":mime,"data":base64}}),
                Attachment::Image{mime,base64,..}=>json!({"type":"image_url","image_url":{"url":format!("data:{mime};base64,{base64}")}}),
            });
        }
        messages.push(json!({"role":"user","content":if r.attachments.is_empty(){json!(r.prompt)}else{json!(content)}}));
        let output = self
            .completion(
                &r.config,
                &system,
                messages,
                if r.mode == Mode::Ask {
                    ResponseFormat::Stream
                } else {
                    ResponseFormat::Proposals
                },
                delta,
            )
            .await?;
        let (reply, ops) = if r.mode == Mode::Ask {
            (output, Vec::new())
        } else {
            #[derive(Deserialize)]
            struct Response {
                reply: String,
                operations: Vec<Value>,
            }
            let response: Response = serde_json::from_str(json_block(&output))?;
            (response.reply, response.operations)
        };
        self.write(|c| {
            let user = AiMessage {
                id: Uuid::new_v4().to_string(),
                project_id: r.project_id.clone(),
                session_id: r.project_id.clone(),
                role: "user".into(),
                content: r.prompt.clone(),
                attachments: json!(r.attachments),
                proposals: json!([]),
                created_at: now(),
            };
            put(c, &user)?;
            let mut ids = Vec::new();
            for op in ops {
                ids.push(proposals::stage(
                    c,
                    &r.project_id,
                    &op,
                    r.mode == Mode::Auto,
                )?);
            }
            let assistant = AiMessage {
                id: Uuid::new_v4().to_string(),
                role: "assistant".into(),
                content: reply,
                attachments: json!([]),
                proposals: json!(ids),
                created_at: now(),
                ..user
            };
            put(c, &assistant)?;
            Ok(assistant)
        })
    }
}
fn includes_secret(value: &Value, secret: &str) -> bool {
    match value {
        Value::String(text) => text.contains(secret),
        Value::Array(rows) => rows.iter().any(|v| includes_secret(v, secret)),
        Value::Object(fields) => fields
            .iter()
            .any(|(k, v)| k.contains(secret) || includes_secret(v, secret)),
        _ => false,
    }
}
// A UTF-8 byte ceiling also bounds byte-level tokenizers without a provider-specific tokenizer.
fn bounded_context(mut context: Value) -> String {
    const BYTES: usize = 32 * 1024;
    let mut full = context.to_string();
    if full.len() <= BYTES {
        return full;
    }
    let focused = context["focus"].take();
    context["focus"] = json!({"id":focused["id"],"title":focused["title"],"excerpt":limited(&focused.to_string(),4000)});
    full = context.to_string();
    full.truncate(full.floor_char_boundary(BYTES.min(full.len())));
    full
}
pub(crate) fn json_block(text: &str) -> &str {
    let s = text.trim();
    s.strip_prefix("```json")
        .or_else(|| s.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .unwrap_or(s)
        .trim()
}
async fn transmit(req: RequestBuilder) -> Result<reqwest::Response> {
    req.send().await.map_err(|e| {
        invalid(if e.is_timeout() {
            "请求超时"
        } else {
            "无法连接 AI 服务"
        })
    })
}
fn check_response(response: reqwest::Response) -> Result<reqwest::Response> {
    if !response.status().is_success() {
        return Err(Error::Invalid(format!(
            "AI 服务返回 HTTP {}",
            response.status()
        )));
    }
    Ok(response)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
}
