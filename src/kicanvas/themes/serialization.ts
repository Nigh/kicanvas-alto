/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/**
 * Serialize/deserialize color themes to and from JSON, so layer color
 * customizations can be exported, shared, and re-imported.
 *
 * Colors are written as CSS strings ("rgba(r, g, b, a)"); everything else
 * is passed through verbatim.
 */

import { Color } from "../../base/color";
import type { Theme } from "../../kicad";

export function serialize_theme(theme: Theme): string {
    return JSON.stringify(serialize(theme), null, 2);
}

function serialize(value: unknown): unknown {
    if (value instanceof Color) {
        return value.to_css();
    }
    if (Array.isArray(value)) {
        return value.map(serialize);
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value)) {
            out[key] = serialize(v);
        }
        return out;
    }
    return value;
}

export function deserialize_theme(json: string): Theme {
    const data = JSON.parse(json) as Record<string, unknown>;
    return {
        name: typeof data["name"] === "string" ? data["name"] : "custom",
        friendly_name:
            typeof data["friendly_name"] === "string"
                ? data["friendly_name"]
                : "Custom",
        board: deserialize_colors(data["board"]),
        schematic: deserialize_colors(data["schematic"]),
    };
}

function deserialize_colors(value: unknown): any {
    if (typeof value === "string") {
        return Color.from_css(value);
    }
    if (Array.isArray(value)) {
        return value.map(deserialize_colors);
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value)) {
            out[key] = deserialize_colors(v);
        }
        return out;
    }
    return value;
}

export function clone_theme(theme: Theme): Theme {
    return deserialize_theme(serialize_theme(theme));
}
