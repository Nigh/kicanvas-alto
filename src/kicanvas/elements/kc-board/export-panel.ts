/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { initiate_download } from "../../../base/dom/download";
import { delegate } from "../../../base/events";
import { BBox, Vec2 } from "../../../base/math";
import { css, html } from "../../../base/web-components";
import { KiCanvasLoadEvent } from "../../../viewers/base/events";
import { KCUIElement } from "../../../kc-ui";
import { LayerNames, LayerSet } from "../../../viewers/board/layers";
import {
    export_board_svg,
    export_layout_animation_svg,
} from "../../../viewers/board/export-svg";
import type { BoardViewer } from "../../../viewers/board/viewer";

export class KCBoardExportPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            .sections,
            .section,
            .export-actions {
                display: flex;
                flex-direction: column;
            }

            .sections {
                gap: 0.75em;
            }

            .section {
                gap: 0.5em;
                min-width: 0;
            }

            .section + .section {
                padding-top: 0.75em;
                border-top: 1px solid var(--grid-outline);
            }

            h2 {
                margin: 0;
                font-size: 0.9em;
                font-weight: 600;
                line-height: 1.3;
            }

            .area-actions,
            .export-row,
            .export-actions {
                display: flex;
                align-items: center;
                gap: 0.5em;
            }

            .area-actions {
                flex-wrap: wrap;
            }

            .area-status {
                margin-right: auto;
            }

            .export-row {
                flex-wrap: wrap;
                justify-content: space-between;
                min-width: 0;
            }

            .export-actions {
                flex-direction: row;
                min-width: 0;
                margin-left: auto;
            }

            select {
                box-sizing: border-box;
                min-width: 0;
                margin: 0;
                padding: 0.3em 0.4em;
                border: var(--input-border);
                border-radius: 0.25em;
                background: var(--input-bg);
                color: var(--input-fg);
                font: inherit;
            }

            kc-ui-button::part(base) {
                white-space: nowrap;
            }

            @media (max-width: 360px) {
                .export-row {
                    align-items: flex-start;
                    flex-direction: column;
                }

                .export-actions {
                    width: 100%;
                }

                .export-actions select {
                    flex: 1 1 auto;
                }
            }
        `,
    ];

    viewer: BoardViewer;
    #export_bbox: BBox | null = null;
    #cancel_area_selection: (() => void) | null = null;

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
            this.setup_events();
        })();
    }

    override disconnectedCallback() {
        this.#cancel_area_selection?.();
        super.disconnectedCallback();
    }

    private setup_events() {
        delegate(this.renderRoot, "kc-ui-button", "click", (_event, source) => {
            switch (source.getAttribute("name")) {
                case "export-svg":
                    this.export_svg();
                    break;
                case "export-static":
                    void this.export_static();
                    break;
                case "export-video":
                    void this.export_video();
                    break;
                case "select-area":
                    this.select_export_area();
                    break;
                case "clear-area":
                    this.#export_bbox = null;
                    this.viewer.set_export_bbox(null);
                    this.update_area_status();
                    break;
            }
        });

        this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
            this.#export_bbox = null;
            this.viewer.set_export_bbox(null);
            this.update_area_status();
        });
    }

    private export_svg() {
        const physical_layers = new LayerSet(
            this.viewer.board,
            this.viewer.theme,
        );
        physical_layers.apply_preset("physical");
        for (const layer of this.viewer.layers.in_ui_order()) {
            const export_layer = physical_layers.by_name(layer.name);
            if (export_layer) export_layer.opacity = layer.opacity;
        }
        const svg = export_layout_animation_svg(
            this.viewer.board,
            physical_layers,
            this.viewer.theme,
            {
                bbox: this.export_bbox(),
                sketch_modes: this.viewer.sketch_modes,
                visible_modes: this.viewer.visible_modes,
            },
        );
        const file = new File([svg], "layout-animation.svg", {
            type: "image/svg+xml",
        });
        initiate_download(file);
    }

    private select_export_area() {
        this.#cancel_area_selection?.();

        const canvas = this.viewer.canvas;
        const old_cursor = canvas.style.cursor;
        let start: Vec2 | null = null;

        const point_for = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            return this.viewer.viewport.camera.screen_to_world(
                new Vec2(event.clientX - rect.left, event.clientY - rect.top),
            );
        };
        const stop_event = (event: PointerEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const on_down = (event: PointerEvent) => {
            stop_event(event);
            start = point_for(event);
            canvas.setPointerCapture(event.pointerId);
        };
        const on_move = (event: PointerEvent) => {
            if (!start) {
                return;
            }
            stop_event(event);
            this.viewer.set_export_bbox(
                BBox.from_points([start, point_for(event)]),
            );
        };
        const cleanup = () => {
            canvas.style.cursor = old_cursor;
            canvas.removeEventListener("pointerdown", on_down, true);
            canvas.removeEventListener("pointermove", on_move, true);
            canvas.removeEventListener("pointerup", on_up, true);
            canvas.removeEventListener("pointercancel", on_cancel, true);
            window.removeEventListener("keydown", on_key);
            this.#cancel_area_selection = null;
        };
        const on_up = (event: PointerEvent) => {
            if (!start) {
                return;
            }
            stop_event(event);
            const bbox = BBox.from_points([start, point_for(event)]);
            if (bbox.valid) {
                this.#export_bbox = bbox;
            }
            this.viewer.set_export_bbox(this.#export_bbox);
            cleanup();
            this.update_area_status();
        };
        const on_cancel = (event: PointerEvent) => {
            if (!start) {
                return;
            }
            stop_event(event);
            this.viewer.set_export_bbox(this.#export_bbox);
            cleanup();
        };
        const on_key = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                this.viewer.set_export_bbox(this.#export_bbox);
                cleanup();
            }
        };

        canvas.style.cursor = "crosshair";
        canvas.addEventListener("pointerdown", on_down, true);
        canvas.addEventListener("pointermove", on_move, true);
        canvas.addEventListener("pointerup", on_up, true);
        canvas.addEventListener("pointercancel", on_cancel, true);
        window.addEventListener("keydown", on_key);
        this.#cancel_area_selection = cleanup;
    }

    private update_area_status() {
        const status = this.renderRoot.querySelector(".area-status");
        if (!status) {
            return;
        }
        status.textContent = this.#export_bbox
            ? `${this.#export_bbox.w.toFixed(1)} × ${this.#export_bbox.h.toFixed(1)} mm`
            : "Full board";
    }

    private export_bbox() {
        if (this.#export_bbox) {
            return this.#export_bbox.copy();
        }
        let bbox = this.viewer.board.edge_cuts_bbox;
        if (!bbox.valid) {
            bbox = this.viewer.layers.bbox;
        }
        return bbox.grow(Math.max(bbox.w, bbox.h) * 0.05);
    }

    private async export_static() {
        const format =
            this.renderRoot.querySelector<HTMLSelectElement>(
                'select[name="static-format"]',
            )?.value ?? "svg";
        const bbox = this.export_bbox();
        const svg = export_board_svg(
            this.viewer.board,
            this.viewer.layers,
            this.viewer.theme,
            {
                bbox,
                sketch_modes: this.viewer.sketch_modes,
                visible_modes: this.viewer.visible_modes,
                transparent_background: format !== "jpg",
            },
            this.viewer.layout_animation?.timeline,
        );

        if (format === "svg") {
            initiate_download(
                new File([svg], "board.svg", { type: "image/svg+xml" }),
            );
            return;
        }

        const mime_type = format === "jpg" ? "image/jpeg" : `image/${format}`;
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error("Unable to render SVG"));
                image.src = url;
            });

            const canvas = document.createElement("canvas");
            const scale = 2048 / Math.max(bbox.w, bbox.h);
            canvas.width = Math.max(1, Math.round(bbox.w * scale));
            canvas.height = Math.max(1, Math.round(bbox.h * scale));
            const context = canvas.getContext("2d");
            if (!context) {
                throw new Error("Unable to create export canvas");
            }
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const raster = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (result) =>
                        result
                            ? resolve(result)
                            : reject(new Error("Unable to encode image")),
                    mime_type,
                    0.92,
                );
            });
            initiate_download(
                new File([raster], `board.${format}`, { type: mime_type }),
            );
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private async export_video() {
        const layers = this.viewer.layers as LayerSet;
        const visibility = new Map(
            [
                ...layers.in_ui_order(),
                layers.by_name(LayerNames.grid)!,
                layers.by_name(LayerNames.drawing_sheet)!,
            ].map((layer) => [layer.name, layer.visible]),
        );
        const existing_animation = this.viewer.layout_animation;
        const animation =
            existing_animation ?? this.viewer.enable_layout_animation();
        const recording_layers = this.viewer.layers as LayerSet;
        recording_layers.apply_preset("physical");

        try {
            const file = await animation?.record_video();
            if (file) initiate_download(file);
        } finally {
            for (const [name, visible] of visibility) {
                recording_layers.by_name(name)!.visible = visible;
            }
            if (!existing_animation) {
                this.viewer.disable_layout_animation();
            } else {
                this.viewer.draw();
            }
        }
    }

    override render() {
        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Export"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <div class="sections">
                        <section class="section">
                            <h2>Export area</h2>
                            <div class="area-actions">
                                <span class="area-status">Full board</span>
                                <kc-ui-button
                                    name="select-area"
                                    title="Drag on the board to select an export area"
                                    >Select area</kc-ui-button
                                >
                                <kc-ui-button
                                    name="clear-area"
                                    title="Export the full board"
                                    >Full board</kc-ui-button
                                >
                            </div>
                        </section>
                        <section class="section">
                            <h2>Export</h2>
                            <div class="export-row">
                                <label for="static-format">Static image</label>
                                <div class="export-actions">
                                    <select
                                        id="static-format"
                                        name="static-format"
                                        aria-label="Static image format">
                                        <option value="svg">SVG</option>
                                        <option value="png">PNG</option>
                                        <option value="webp">WebP</option>
                                        <option value="jpg">JPEG</option>
                                    </select>
                                    <kc-ui-button
                                        name="export-static"
                                        title="Export current visibility and opacity"
                                        >Export</kc-ui-button
                                    >
                                </div>
                            </div>
                            <div class="export-row">
                                <span>Animated SVG</span>
                                <kc-ui-button
                                    name="export-svg"
                                    icon="image"
                                    title="Export layout animation as SVG"
                                    >Export SVG</kc-ui-button
                                >
                            </div>
                            <div class="export-row">
                                <span>Video</span>
                                <kc-ui-button
                                    name="export-video"
                                    icon="movie"
                                    title="Record layout animation as video"
                                    >Export video</kc-ui-button
                                >
                            </div>
                        </section>
                    </div>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-board-export-panel",
    KCBoardExportPanelElement,
);
