use std::path::PathBuf;

#[cfg(any(windows, test))]
fn safe_filename(name: &str, extension: &str) -> String {
    let cleaned = name.replace(|c: char| c.is_control() || r#"<>:"/\|?*"#.contains(c), "_");
    let name = cleaned.trim_end_matches(['.', ' ']);
    let mut name = if name.is_empty() { "export" } else { name }.to_owned();
    let base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || base
            .strip_prefix("COM")
            .or_else(|| base.strip_prefix("LPT"))
            .is_some_and(|n| {
                matches!(
                    n,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
    {
        name.insert(0, '_');
    }
    if !extension.is_empty()
        && !name
            .to_ascii_lowercase()
            .ends_with(&format!(".{}", extension.to_ascii_lowercase()))
    {
        name.push('.');
        name.push_str(extension);
    }
    name
}

#[cfg(windows)]
pub fn pick_save_path(
    default_name: &str,
    filter_label: &str,
    extension: &str,
) -> Result<Option<PathBuf>, String> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetSaveFileNameW, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT,
        OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    let extension = extension.trim_start_matches('.');
    if extension.contains(|c: char| c.is_control() || r#"<>:"/\|?*"#.contains(c))
        || filter_label.contains('\0')
    {
        return Err("文件筛选条件无效".into());
    }
    let pattern = if extension.is_empty() {
        "*.*".to_owned()
    } else {
        format!("*.{extension}")
    };
    let filter: Vec<_> = format!("{filter_label} ({pattern})\0{pattern}\0所有文件 (*.*)\0*.*\0\0")
        .encode_utf16()
        .collect();
    let def_ext: Vec<_> = extension.encode_utf16().chain([0]).collect();
    let mut file: Vec<_> = safe_filename(default_name, extension)
        .encode_utf16()
        .collect();
    file.resize((file.len() + 1).max(32768), 0);
    let mut dialog = OPENFILENAMEW {
        lStructSize: size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: filter.as_ptr(),
        nFilterIndex: 1,
        lpstrFile: file.as_mut_ptr(),
        nMaxFile: file.len() as u32,
        lpstrDefExt: def_ext.as_ptr(),
        Flags: OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST,
        ..Default::default()
    };
    // All pointers refer to buffers that live throughout this synchronous call.
    if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
        let code = unsafe { CommDlgExtendedError() };
        return if code == 0 {
            Ok(None)
        } else {
            Err(format!("打开保存对话框失败 (0x{code:04x})"))
        };
    }
    let len = file.iter().position(|&c| c == 0).unwrap_or(file.len());
    Ok(Some(OsString::from_wide(&file[..len]).into()))
}

#[cfg(not(windows))]
pub fn pick_save_path(_: &str, _: &str, _: &str) -> Result<Option<PathBuf>, String> {
    Err("当前平台暂不支持系统保存对话框".into())
}

#[cfg(test)]
mod tests {
    use super::safe_filename;

    #[test]
    fn sanitizes_windows_filenames() {
        assert_eq!(safe_filename("村/庄:\n? . ", "png"), "村_庄___.png");
        assert_eq!(safe_filename("aux.json", "json"), "_aux.json");
        assert_eq!(safe_filename("...  ", "tmj"), "export.tmj");
        assert_eq!(safe_filename("", ""), "export");
        assert_eq!(safe_filename("地图", "json"), "地图.json");
        assert_eq!(safe_filename("地图.PNG", "png"), "地图.PNG");
    }
}
