use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Variables = BTreeMap<String, f64>;
fn invalid(message: &str) -> Error {
    Error::Invalid(message.into())
}
enum Expression {
    Number(f64),
    Variable(String),
    Negative(Box<Self>),
    Binary(u8, Box<Self>, Box<Self>),
    Call(String, Vec<Self>),
}
struct Parser<'a> {
    rest: &'a str,
}
impl Parser<'_> {
    fn peek(&mut self) -> Option<u8> {
        self.rest = self.rest.trim_start();
        self.rest.as_bytes().first().copied()
    }
    fn take(&mut self, token: u8) -> bool {
        if self.peek() == Some(token) {
            self.rest = &self.rest[1..];
            true
        } else {
            false
        }
    }
    fn expression(&mut self, min: u8, depth: u16) -> Result<Expression> {
        if depth > 64 {
            return Err(invalid("公式嵌套过深"));
        }
        let mut left = match self.peek() {
            Some(b'-') => {
                self.take(b'-');
                Expression::Negative(Box::new(self.expression(3, depth + 1)?))
            }
            Some(b'(') => {
                self.take(b'(');
                let inner = self.expression(0, depth + 1)?;
                if !self.take(b')') {
                    return Err(invalid("缺少右括号"));
                }
                inner
            }
            Some(b'0'..=b'9' | b'.') => {
                let mut len = self
                    .rest
                    .bytes()
                    .take_while(|b| b.is_ascii_digit() || *b == b'.')
                    .count();
                if matches!(self.rest.as_bytes().get(len), Some(b'e' | b'E')) {
                    len += 1;
                    if matches!(self.rest.as_bytes().get(len), Some(b'+' | b'-')) {
                        len += 1
                    }
                    len += self.rest[len..]
                        .bytes()
                        .take_while(u8::is_ascii_digit)
                        .count();
                }
                let (number, tail) = self.rest.split_at(len);
                self.rest = tail;
                Expression::Number(number.parse().map_err(|_| invalid("数字无效"))?)
            }
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'_') => {
                let len = self
                    .rest
                    .bytes()
                    .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
                    .count();
                let (name, tail) = self.rest.split_at(len);
                self.rest = tail;
                if self.take(b'(') {
                    let mut args = vec![];
                    if !self.take(b')') {
                        loop {
                            args.push(self.expression(0, depth + 1)?);
                            if self.take(b')') {
                                break;
                            }
                            if !self.take(b',') {
                                return Err(invalid("函数参数之间缺少逗号"));
                            }
                        }
                    }
                    Expression::Call(name.into(), args)
                } else {
                    Expression::Variable(name.into())
                }
            }
            _ => return Err(invalid("缺少操作数")),
        };
        while let Some(op) = self.peek() {
            let binding = match op {
                b'+' | b'-' => 1,
                b'*' | b'/' => 2,
                b'^' => 4,
                _ => break,
            };
            if binding < min {
                break;
            }
            self.take(op);
            let right = self.expression(binding + u8::from(op != b'^'), depth + 1)?;
            left = Expression::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}
impl Expression {
    fn value(&self, level: i32, vars: &Variables) -> Result<f64> {
        let result = match self {
            Self::Number(n) => *n,
            Self::Variable(s) => match s.as_str() {
                "level" | "x" => f64::from(level),
                "pi" => std::f64::consts::PI,
                "e" => std::f64::consts::E,
                _ => *vars
                    .get(s)
                    .ok_or_else(|| Error::Invalid(format!("未知变量 {s}")))?,
            },
            Self::Negative(a) => -a.value(level, vars)?,
            Self::Binary(op, a, b) => {
                let a = a.value(level, vars)?;
                let b = b.value(level, vars)?;
                match op {
                    b'+' => a + b,
                    b'-' => a - b,
                    b'*' => a * b,
                    b'/' => a / b,
                    _ => a.powf(b),
                }
            }
            Self::Call(name, args) => {
                let v = args
                    .iter()
                    .map(|a| a.value(level, vars))
                    .collect::<Result<Vec<_>>>()?;
                match (name.as_str(), v.as_slice()) {
                    ("min", [a, rest @ ..]) => rest.iter().copied().fold(*a, f64::min),
                    ("max", [a, rest @ ..]) => rest.iter().copied().fold(*a, f64::max),
                    ("floor", [a]) => a.floor(),
                    ("ceil", [a]) => a.ceil(),
                    ("round", [a]) => a.round(),
                    ("sqrt", [a]) => a.sqrt(),
                    ("abs", [a]) => a.abs(),
                    ("log", [a]) => a.log10(),
                    ("log", [a, b]) => a.log(*b),
                    ("ln", [a]) => a.ln(),
                    ("clamp", [a, lo, hi]) if lo <= hi => a.clamp(*lo, *hi),
                    _ => return Err(Error::Invalid(format!("函数或参数无效：{name}"))),
                }
            }
        };
        if !result.is_finite() {
            return Err(invalid("公式结果超出有限数值范围"));
        }
        Ok(result)
    }
}
#[derive(Serialize, Debug)]
pub struct CurvePoint {
    pub level: i32,
    pub value: f64,
}
pub fn evaluate_curve(
    expr: &str,
    min_level: i32,
    max_level: i32,
    vars: &Variables,
) -> Result<Vec<CurvePoint>> {
    if expr.len() > 1024 || !(0..10000).contains(&(i64::from(max_level) - i64::from(min_level))) {
        return Err(invalid("公式过长或等级范围无效"));
    }
    let mut parser = Parser { rest: expr };
    let tree = parser.expression(0, 0)?;
    if parser.peek().is_some() {
        return Err(invalid("公式含多余字符"));
    }
    (min_level..=max_level)
        .map(|level| {
            Ok(CurvePoint {
                level,
                value: tree.value(level, vars)?,
            })
        })
        .collect()
}

fn one() -> u32 {
    1
}

#[derive(Clone, Deserialize)]
pub struct DropEntry {
    pub id: String,
    pub weight: f64,
    #[serde(alias = "unitValue")]
    pub value: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantityDropEntry {
    #[serde(flatten)]
    pub item: DropEntry,
    #[serde(default = "one")]
    pub min_qty: u32,
    #[serde(default = "one")]
    pub max_qty: u32,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DropOutcome {
    pub id: String,
    pub probability: f64,
    pub count: u32,
    pub drop_rate: f64,
    pub expected_quantity: f64,
    pub total_quantity: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DropSimulation {
    pub entries: Vec<DropOutcome>,
    pub expected_value: f64,
    pub simulated_value: f64,
    pub total_value: f64,
    pub rolls: u32,
}
// SplitMix64; the upper 53 bits give a uniform f64 in [0, 1).
fn draw(state: &mut u64) -> f64 {
    *state = state.wrapping_add(0x9e3779b97f4a7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    ((z ^ (z >> 31)) >> 11) as f64 / 9007199254740992.
}
pub fn simulate_drop_table(entries: &[DropEntry], rolls: u32, seed: u64) -> Result<DropSimulation> {
    let mut total = 0.;
    let mut ends = Vec::new();
    for e in entries {
        if !e.weight.is_finite() || e.weight < 0. || !e.value.is_finite() {
            return Err(invalid("掉落权重、数量范围或单价无效"));
        }
        total += e.weight;
        ends.push(total)
    }
    if !(1..=10_000_000).contains(&rolls) || total <= 0. || !total.is_finite() {
        return Err(invalid("抽取次数或总权重无效"));
    }
    let mut counts = vec![0u32; entries.len()];
    let mut state = seed;
    for _ in 0..rolls {
        let u = draw(&mut state);
        counts[ends.partition_point(|w| *w / total <= u)] += 1;
    }
    let mut expected_value = 0.;
    let mut total_value = 0.;
    let outcomes = entries
        .iter()
        .zip(counts)
        .map(|(e, count)| {
            let probability = e.weight / total;
            let drop_rate = f64::from(count) / f64::from(rolls);
            expected_value += probability * e.value;
            total_value += f64::from(count) * e.value;
            DropOutcome {
                id: e.id.clone(),
                probability,
                count,
                drop_rate,
                expected_quantity: probability,
                total_quantity: u64::from(count),
            }
        })
        .collect();
    if !expected_value.is_finite() || !total_value.is_finite() {
        return Err(invalid("产出价值超出数值范围"));
    }
    Ok(DropSimulation {
        entries: outcomes,
        expected_value,
        simulated_value: total_value / f64::from(rolls),
        total_value,
        rolls,
    })
}
pub fn simulate_quantity_drop_table(
    entries: &[QuantityDropEntry],
    rolls: u32,
    seed: u64,
) -> Result<DropSimulation> {
    if entries.iter().any(|e| e.min_qty > e.max_qty) {
        return Err(invalid("掉落数量范围无效"));
    }
    let weights = entries
        .iter()
        .map(|e| DropEntry {
            id: e.item.id.clone(),
            weight: e.item.weight,
            value: 0.,
        })
        .collect::<Vec<_>>();
    // First roll the weighted hits, then roll the quantity for each hit in a separate stream.
    let mut sim = simulate_drop_table(&weights, rolls, seed)?;
    let mut state = seed ^ 0xa0761d6478bd642f;
    for (row, entry) in sim.entries.iter_mut().zip(entries) {
        if !entry.item.value.is_finite() {
            return Err(invalid("掉落单价无效"));
        }
        row.expected_quantity =
            row.probability * (f64::from(entry.min_qty) + f64::from(entry.max_qty)) / 2.;
        row.total_quantity = u64::from(row.count) * u64::from(entry.min_qty);
        if entry.max_qty > entry.min_qty {
            let width = f64::from(entry.max_qty - entry.min_qty) + 1.;
            row.total_quantity += (0..row.count)
                .map(|_| (draw(&mut state) * width) as u64)
                .sum::<u64>();
        }
        sim.total_value += row.total_quantity as f64 * entry.item.value;
        sim.expected_value += row.expected_quantity * entry.item.value;
    }
    if !sim.total_value.is_finite() || !sim.expected_value.is_finite() {
        return Err(invalid("产出价值超出数值范围"));
    }
    sim.simulated_value = sim.total_value / f64::from(rolls);
    Ok(sim)
}
