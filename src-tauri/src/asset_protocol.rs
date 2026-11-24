use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tauri::http::{Request, Response};

fn interval(range: &str, size: u64) -> Option<(u64, u64)> {
    let (start, end) = range.strip_prefix("bytes=")?.split_once('-')?;
    if size == 0 {
        return None;
    }
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        return (suffix > 0).then_some((size.saturating_sub(suffix), size - 1));
    }
    let first = start.parse().ok()?;
    let last = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (first <= last).then_some((first, last))
}
pub fn serve(
    path: &Path,
    name: &str,
    request: &Request<Vec<u8>>,
) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut builder = Response::builder()
        .header("Content-Type", gws_core::assets::mime_type(name))
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "public,max-age=31536000,immutable")
        .header("Accept-Ranges", "bytes");
    let length = if let Some(range) = request.headers().get("Range") {
        let Some((first, last)) = range.to_str().ok().and_then(|r| interval(r, size)) else {
            return Ok(builder
                .status(416)
                .header("Content-Range", format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap());
        };
        builder = builder
            .status(206)
            .header("Content-Range", format!("bytes {first}-{last}/{size}"));
        file.seek(SeekFrom::Start(first))?;
        last - first + 1
    } else {
        size
    };
    let mut data = Vec::new();
    if request.method() != "HEAD" {
        file.take(length).read_to_end(&mut data)?;
    }
    Ok(builder.header("Content-Length", length).body(data).unwrap())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_requests_can_seek_and_report_mime() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.ogg");
        std::fs::write(&path, b"0123456789").unwrap();
        for (range, data) in [
            ("bytes=2-4", "234"),
            ("bytes=7-", "789"),
            ("bytes=-2", "89"),
        ] {
            let req = Request::builder()
                .header("Range", range)
                .body(vec![])
                .unwrap();
            let out = serve(&path, "audio.ogg", &req).unwrap();
            assert_eq!(out.status(), 206);
            assert_eq!(out.headers()["Content-Type"], "audio/ogg");
            assert_eq!(out.body(), data.as_bytes());
        }
        let invalid = Request::builder()
            .header("Range", "bytes=10-20")
            .body(vec![])
            .unwrap();
        assert_eq!(serve(&path, "audio.ogg", &invalid).unwrap().status(), 416);
    }
}
