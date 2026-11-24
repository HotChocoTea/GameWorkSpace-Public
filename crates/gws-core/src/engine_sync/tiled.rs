use crate::{impact::rows, Error, MapRecord, Result};
use serde_json::{json, Value};

// The atlas uses one pixel per terrain. Tiled stretches each tile to grid size.
pub(super) fn export(map: &MapRecord, stem: &str) -> Result<(Value, Vec<u8>)> {
    let count = map
        .width
        .checked_mul(map.height)
        .filter(|n| (1..=4_194_304).contains(n))
        .ok_or_else(|| Error::Invalid("地图尺寸超出范围".into()))? as usize;
    let mut palette = vec![
        0xb2a384u32,
        0x697986,
        0xbf9d72,
        0x69976a,
        0x49899e,
        0x9d7954,
        0xac6562,
        0x9681ae,
        0xd7c797,
        0x88bcb9,
        0x3a627c,
        0x437864,
        0x8d9090,
        0xa7a49a,
        0xae8059,
        0x8a7154,
        0xc9ad60,
        0xb6bdc2,
        0x98b38a,
    ];
    for (i, t) in rows(&map.custom_tiles).iter().enumerate() {
        let id = t["id"].as_u64().unwrap_or(20 + i as u64);
        if !(1..=65535).contains(&id) {
            return Err(Error::Invalid("地图图块编号无效".into()));
        }
        palette.resize(palette.len().max(id as usize), 0);
        palette[id as usize - 1] = t["color"]
            .as_str()
            .and_then(|s| u32::from_str_radix(s.trim_start_matches('#'), 16).ok())
            .unwrap_or(0x728e81);
    }
    let mut layers = Vec::new();
    let empty = json!({"name":"底图"});
    let source = rows(&map.layers);
    for layer in if source.is_empty() {
        std::slice::from_ref(&empty)
    } else {
        source
    } {
        let mut tiles = Vec::with_capacity(count);
        for v in rows(&layer["tiles"]).iter().take(count) {
            let id = v.as_u64().unwrap_or_default();
            if id > palette.len() as u64 {
                return Err(Error::Invalid(format!("地图图块 {id} 不存在")));
            }
            tiles.push(id);
        }
        tiles.resize(count, 0);
        layers.push(json!({"id":layers.len()+1,"type":"tilelayer","name":layer["name"].as_str().unwrap_or("图层"),"width":map.width,"height":map.height,"x":0,"y":0,"opacity":1,"visible":layer["visible"]!=false,"data":tiles}));
    }
    let objects:Vec<_>=rows(&map.pins).iter().enumerate().map(|(i,p)|json!({"id":i+1,"name":p["label"].as_str().unwrap_or("图钉"),"point":true,"x":(p["x"].as_f64().unwrap_or(0.)+0.5)*map.tile_size as f64,"y":(p["y"].as_f64().unwrap_or(0.)+0.5)*map.tile_size as f64,"rotation":0,"visible":true,"width":0,"height":0,"properties":[{"name":"entityId","type":"string","value":p["entityId"].as_str().unwrap_or("")},{"name":"pinId","type":"string","value":p["id"].as_str().unwrap_or("")}]})).collect();
    layers.push(json!({"id":layers.len()+1,"type":"objectgroup","name":"图钉","draworder":"topdown","x":0,"y":0,"opacity":1,"visible":true,"objects":objects}));
    let width = palette.len() as u32;
    let size = (width * 3).next_multiple_of(4);
    let mut bmp = vec![0; 54 + size as usize];
    bmp[..2].copy_from_slice(b"BM");
    for (offset, value) in [
        (2, 54 + size),
        (10, 54),
        (14, 40),
        (18, width),
        (22, 1),
        (34, size),
    ] {
        bmp[offset..offset + 4].copy_from_slice(&value.to_le_bytes())
    }
    bmp[26] = 1;
    bmp[28] = 24;
    for (pixel, color) in bmp[54..].as_chunks_mut::<3>().0.iter_mut().zip(palette) {
        pixel.copy_from_slice(&color.to_le_bytes()[..3])
    }
    let data = json!({"type":"map","version":"1.10","tiledversion":"1.10.2","orientation":"orthogonal","renderorder":"right-down","infinite":false,"width":map.width,"height":map.height,"tilewidth":map.tile_size,"tileheight":map.tile_size,"nextlayerid":layers.len()+1,"nextobjectid":objects.len()+1,"layers":layers,"tilesets":[{"firstgid":1,"name":"Terrain","tilewidth":1,"tileheight":1,"tilecount":width,"columns":width,"spacing":0,"margin":0,"tilerendersize":"grid","image":format!("{stem}.bmp"),"imagewidth":width,"imageheight":1}]});
    Ok((data, bmp))
}
