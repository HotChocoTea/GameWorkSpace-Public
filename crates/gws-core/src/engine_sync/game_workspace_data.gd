class_name GameWorkSpaceData
extends RefCounted

class Entity:
    var id: String
    var title: String
    var status: String
    var data: Dictionary

    func _init(row: Dictionary) -> void:
        id = row.get("id", "")
        title = row.get("title", "")
        status = row.get("status", "")
        data = row.get("data") if row.get("data") is Dictionary else {}

static func load_rows(path: String) -> Array[Dictionary]:
    var result: Array[Dictionary] = []
    var file := FileAccess.open(path, FileAccess.READ)
    if file == null:
        push_error("Cannot read " + path)
        return result
    var rows: Variant = JSON.parse_string(file.get_as_text())
    if rows is Array:
        for row in rows:
            if row is Dictionary:
                result.append(row)
    return result

static func load_entities(path: String) -> Array[Entity]:
    var result: Array[Entity] = []
    for row in load_rows(path):
        result.append(Entity.new(row))
    return result
