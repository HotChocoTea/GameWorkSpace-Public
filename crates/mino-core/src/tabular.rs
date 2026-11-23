use crate::{Error, Result};
use calamine::{open_workbook_auto_from_rs, Data, DataType, Reader};
use serde::Serialize;
use std::io::Cursor;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
}

pub fn parse(bytes: &[u8], filename: &str) -> Result<Table> {
    parse_sheets(bytes, filename, true)?
        .into_iter()
        .next()
        .ok_or_else(|| Error::Invalid("缺少工作表".into()))
}

pub fn parse_all(bytes: &[u8], filename: &str) -> Result<Vec<Table>> {
    parse_sheets(bytes, filename, false)
}

fn parse_sheets(bytes: &[u8], filename: &str, first_only: bool) -> Result<Vec<Table>> {
    let invalid = |message: String| Error::Invalid(format!("无法读取表格：{message}"));
    let records: Vec<Vec<String>> = match filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "csv" => csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
            .records()
            .map(|row| row.map(|r| r.iter().map(str::to_owned).collect()))
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| invalid(e.to_string()))?,
        "xls" | "xlsx" => {
            let mut book = open_workbook_auto_from_rs(Cursor::new(bytes))
                .map_err(|e| invalid(e.to_string()))?;
            let count = if first_only {
                1
            } else {
                book.sheet_names().len()
            };
            let mut tables = Vec::new();
            for i in 0..count {
                let sheet = book
                    .worksheet_range_at(i)
                    .ok_or_else(|| invalid("缺少工作表".into()))?
                    .map_err(|e| invalid(e.to_string()))?;
                let records: Vec<Vec<String>> = sheet
                    .rows()
                    .map(|row| {
                        row.iter()
                            .map(|cell| match cell {
                                Data::DateTime(_) => cell
                                    .as_date()
                                    .map(|date| date.to_string())
                                    .unwrap_or_else(|| cell.to_string()),
                                _ => cell.to_string(),
                            })
                            .collect()
                    })
                    .collect();
                if records
                    .iter()
                    .any(|r| r.iter().any(|v| !v.trim().is_empty()))
                {
                    tables.push(make_table(records)?)
                }
            }
            if tables.is_empty() {
                return Err(invalid("表格为空".into()));
            }
            return Ok(tables);
        }
        _ => return Err(invalid("请选择 CSV、XLS 或 XLSX 文件".into())),
    };
    Ok(vec![make_table(records)?])
}

fn make_table(records: Vec<Vec<String>>) -> Result<Table> {
    let mut records = records
        .into_iter()
        .filter(|r| r.iter().any(|v| !v.trim().is_empty()));
    let headers = records
        .next()
        .ok_or_else(|| Error::Invalid("无法读取表格：表格为空".into()))?;
    let rows: Vec<_> = records.collect();
    Ok(Table {
        total_rows: rows.len(),
        headers,
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_handles_bom_quotes_multiline_and_empty_cells() {
        let table = parse(
            "\u{feff}标题,说明,版本\r\n卡船,\"进入,离开\n港口\",\r\n,,".as_bytes(),
            "bugs.CSV",
        )
        .unwrap();
        assert_eq!(table.headers, ["标题", "说明", "版本"]);
        assert_eq!(table.total_rows, 1);
        assert_eq!(table.rows[0], ["卡船", "进入,离开\n港口", ""]);
    }

    #[test]
    fn xlsx_preserves_column_positions_and_numbers() {
        let table = parse(include_bytes!("../tests/fixtures/bugs.xlsx"), "report.xlsx").unwrap();
        assert_eq!(table.headers, ["标题", "说明", "版本"]);
        assert_eq!(table.rows, [vec!["卡船", "", "2"]]);
        assert_eq!(table.total_rows, 1);
        assert!(parse(b"invalid", "broken.xls").is_err());
    }
}
