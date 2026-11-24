using System;
using UnityEngine;

namespace GameWorkSpace
{
    public static class GameWorkSpaceData
    {
        [Serializable] public class EntityData
        {
            public string category, rarity, enginePath, owner, priority, asset;
            public string giverId, questId, locationId, parentId, expression;
            public string[] linkedEntityIds, prerequisites, castIds;
            public Line[] lines;
        }
        [Serializable] public class Entity
        {
            public string id, title, subtitle, summary, body, status;
            public string[] tags;
            public EntityData data;
        }
        [Serializable] public class Choice { public string text, nextLineId; }
        [Serializable] public class Line { public string id, speakerId, speakerName, text, condition, nextLineId; public Choice[] choices; }
        [Serializable] public class Ingredient { public string itemId; public int qty; }
        [Serializable] public class Recipe { public string id, outputItemId, note; public int outputQty; public Ingredient[] ingredients; public string[] tools; }
        [Serializable] private class Rows<T> { public T[] rows; }

        public static T[] Load<T>(TextAsset file)
        {
            return JsonUtility.FromJson<Rows<T>>("{\"rows\":" + file.text + "}").rows;
        }
    }
}
