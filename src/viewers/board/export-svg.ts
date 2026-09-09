/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/**
 * Exports the layout animation as a self-contained animated SVG.
 *
 * The board is painted into a NullRenderer with the animation's timeline
 * active, producing the same time-bucketed view layers the interactive
 * animation uses. Each bucket becomes an SVG <g> element shown by a SMIL
 * <set> element, so the file plays in browsers and respects the current
 * layer visibility.
 */

import { NullRenderer, NullRenderLayer } from "../../graphics/null-renderer";
import type { Arc, Circle, Polygon, Polyline } from "../../graphics/shapes";
import type { KicadPCB } from "../../kicad/board";
import {
    LayoutTimeline,
    base_layer_name,
    bucket_of,
    bucket_layer_name,
} from "./animation";
import { LayerSet } from "./layers";
import { BoardPainter } from "./painter";

export interface SVGExportOptions {
    /** Include layers that are hidden in the viewer. Defaults to false. */
    include_hidden?: boolean;
}

/**
 * Renders the board with the layout animation applied and returns an
 * animated SVG document as a string.
 */
export function export_layout_animation_svg(
    board: KicadPCB,
    layer_set: LayerSet,
    theme: ConstructorParameters<typeof LayerSet>[1],
    options: SVGExportOptions = {},
): string {
    const timeline = new LayoutTimeline(board);

    // Paint into a null renderer using a fresh layer set with bucketed
    // layers, just like the interactive animation.
    const export_layers = new LayerSet(board, theme);
    const gfx = new NullRenderer();
    const painter = new BoardPainter(gfx, export_layers, theme);
    painter.timeline = timeline;
    painter.paint(board);

    const layers: {
        layer: NullRenderLayer;
        name: string;
        bucket: number | null;
    }[] = [];

    for (const view_layer of export_layers.in_display_order()) {
        const render_layer = view_layer.graphics as NullRenderLayer | undefined;
        if (!render_layer?.shapes.length) {
            continue;
        }
        if (
            !options.include_hidden &&
            !layer_set.by_name(base_layer_name(view_layer.name))?.visible
        ) {
            continue;
        }
        layers.push({
            layer: render_layer,
            name: view_layer.name,
            bucket: bucket_of(view_layer.name),
        });
    }

    // Board extents for the viewBox
    let bbox = board.edge_cuts_bbox;
    if (!bbox.w || !bbox.h) {
        bbox = export_layers.bbox;
    }
    bbox = bbox.grow(Math.max(bbox.w, bbox.h) * 0.05);

    const background = theme.background?.to_css() ?? "#000";
    const duration = timeline.duration;
    const total = timeline.total_buckets;

    const parts: string[] = [];
    parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
            `viewBox="${fmt(bbox.x)} ${fmt(bbox.y)} ${fmt(bbox.w)} ${fmt(
                bbox.h,
            )}" width="800">`,
    );
    parts.push(
        `<rect x="${fmt(bbox.x)}" y="${fmt(bbox.y)}" ` +
            `width="${fmt(bbox.w)}" height="${fmt(bbox.h)}" ` +
            `fill="${background}"/>`,
    );

    // Bucket layers come with a SMIL <set> that shows them at their time
    // and keeps them visible indefinitely.
    for (const { layer, bucket } of layers) {
        const begin = bucket == null ? null : timeline.time_for_bucket(bucket);
        const visibility =
            bucket == null ? `visibility="visible"` : `visibility="hidden"`;
        const animate =
            begin == null
                ? ""
                : `<set attributeName="visibility" to="visible" ` +
                  `begin="${begin.toFixed(3)}s" dur="indefinite" ` +
                  `repeatCount="indefinite"/>`;
        parts.push(`<g ${visibility}>`);
        if (animate) {
            parts.push(animate);
        }
        for (const shape of layer.shapes) {
            parts.push(shape_to_svg(shape));
        }
        parts.push(`</g>`);
    }

    if (total) {
        // Restart the animation by wrapping it in an outer <set>... SMIL
        // has no simple loop primitive for this; browsers restart <set>
        // animations when the document's time container repeats, which we
        // approximate with a repeating dummy animation that resets time.
        parts.push(
            `<animate attributeName="opacity" values="1" ` +
                `dur="${duration.toFixed(3)}s" repeatCount="indefinite"/>`,
        );
    }

    parts.push(`</svg>`);
    return parts.join("\n");
}

function css_color(color: { to_css(): string } | false | null): string {
    return color ? color.to_css() : "none";
}

function shape_to_svg(shape: Circle | Arc | Polygon | Polyline): string {
    if ("radius" in shape && "center" in shape && !("points" in shape)) {
        if ("start_angle" in shape) {
            return arc_to_svg(shape as Arc);
        }
        const c = shape as Circle;
        return (
            `<circle cx="${fmt(c.center.x)}" cy="${fmt(c.center.y)}" ` +
            `r="${fmt(c.radius)}" fill="${css_color(c.color)}"/>`
        );
    }
    if ("points" in shape) {
        const points = (shape as Polyline | Polygon).points
            .map((p) => `${fmt(p.x)},${fmt(p.y)}`)
            .join(" ");
        if ("width" in shape) {
            const l = shape as Polyline;
            return (
                `<polyline points="${points}" fill="none" ` +
                `stroke="${css_color(l.color)}" ` +
                `stroke-width="${fmt(l.width)}" stroke-linecap="round"/>`
            );
        }
        const p = shape as Polygon;
        return (
            `<polygon points="${points}" ` + `fill="${css_color(p.color)}"/>`
        );
    }
    return "";
}

function arc_to_svg(arc: Arc): string {
    // Approximate arcs with a polyline, matching the canvas renderers.
    const points: string[] = [];
    const start = arc.start_angle.radians;
    const end = arc.end_angle.radians;
    const span = end - start;
    const steps = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 16)));
    for (let i = 0; i <= steps; i++) {
        const a = start + (span * i) / steps;
        points.push(
            `${fmt(arc.center.x + Math.cos(a) * arc.radius)},` +
                `${fmt(arc.center.y + Math.sin(a) * arc.radius)}`,
        );
    }
    return (
        `<polyline points="${points.join(" ")}" fill="none" ` +
        `stroke="${css_color(arc.color)}" ` +
        `stroke-width="${fmt(arc.width)}" stroke-linecap="round"/>`
    );
}

function fmt(n: number): string {
    return Number(n.toFixed(4)).toString();
}

export { bucket_layer_name };
