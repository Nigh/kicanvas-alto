/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { BBox, Vec2 } from "../../base/math";
import { is_string } from "../../base/types";
import { Color, Polygon, Polyline, Renderer } from "../../graphics";
import { WebGL2Renderer } from "../../graphics/webgl";
import type { BoardTheme } from "../../kicad";
import * as kicad_common from "../../kicad/common";
import * as board_items from "../../kicad/board";
import { DocumentViewer } from "../base/document-viewer";
import {
    LayoutAnimationController,
    LayoutTimeline,
    base_layer_name,
} from "./animation";
import { LayerNames, LayerSet, ViewLayer } from "./layers";
import {
    BoardPainter,
    type BoardObjectType,
    type BoardSketchModes,
    type BoardVisibleModes,
    type BoardVisibleType,
} from "./painter";

export type ContextMenuCallback = (
    screenX: number,
    screenY: number,
    items: Map<string, unknown>,
    onSelect: (item: unknown) => void,
) => void;

export class BoardViewer extends DocumentViewer<
    board_items.KicadPCB,
    BoardPainter,
    LayerSet,
    BoardTheme
> {
    #contextMenuCallback: ContextMenuCallback | null = null;
    #export_bbox: BBox | null = null;
    #track_opacity = 1;
    #via_opacity = 1;
    #zone_opacity = 1;
    #pad_opacity = 1;
    #pad_hole_opacity = 1;
    #grid_opacity = 1;
    #page_opacity = 1;
    #sketch_modes: BoardSketchModes = {
        tracks: false,
        vias: false,
        pads: false,
        holes: false,
        zones: false,
    };
    #visible_modes: BoardVisibleModes = {
        tracks: true,
        vias: true,
        pads: true,
        holes: true,
        zones: true,
        grid: true,
        page: true,
    };

    get board(): board_items.KicadPCB {
        return this.document;
    }

    set_export_bbox(bbox: BBox | null) {
        this.#export_bbox = bbox?.copy() ?? null;
        this.paint_selected();
    }

    protected override paint_selected() {
        const layer = this.layers.overlay;
        layer.clear();
        if (this.selected || this.#export_bbox) {
            this.renderer.start_layer(layer.name);
            if (this.selected) {
                const bbox = this.selected.copy().grow(this.selected.w * 0.1);
                this.renderer.line(
                    Polyline.from_BBox(bbox, 0.254, Color.white),
                );
                this.renderer.polygon(Polygon.from_BBox(bbox, Color.white));
            }
            if (this.#export_bbox) {
                this.renderer.line(
                    Polyline.from_BBox(this.#export_bbox, 0.254, Color.white),
                );
            }
            layer.graphics = this.renderer.end_layer();
            layer.graphics.composite_operation = "overlay";
        }
        this.draw();
    }

    set contextMenuCallback(callback: ContextMenuCallback | null) {
        this.#contextMenuCallback = callback;
    }

    protected override create_renderer(canvas: HTMLCanvasElement): Renderer {
        const renderer = new WebGL2Renderer(canvas);
        return renderer;
    }

    protected override create_painter() {
        return new BoardPainter(this.renderer, this.layers, this.theme);
    }

    protected override on_painter_created(painter: BoardPainter) {
        painter.sketch_modes = this.#sketch_modes;
        painter.visible_modes = this.#visible_modes;
        this.layers.by_name(LayerNames.grid)!.visible =
            this.#visible_modes.grid;
        this.layers.by_name(LayerNames.drawing_sheet)!.visible =
            this.#visible_modes.page;
        if (this.#animation_timeline) {
            painter.timeline = this.#animation_timeline;
        }
    }

    protected override on_document_loaded() {
        if (this.#animation_controller) {
            // The document changed, rebuild the animation from scratch.
            this.#animation_controller.dispose();
            this.#animation_controller = null;
            this.#animation_timeline = null;
            this.paint();
            this.draw();
        }
    }

    #animation_timeline: LayoutTimeline | null = null;
    #animation_controller: LayoutAnimationController | null = null;

    /**
     * The active layout animation controller, or null if the layout
     * animation hasn't been started yet.
     */
    get layout_animation(): LayoutAnimationController | null {
        return this.#animation_controller;
    }

    /**
     * Turns the layout animation on: repaints the board with animatable
     * items sorted into time-bucketed layers. Returns the animation
     * controller, or null if there's nothing to animate.
     */
    enable_layout_animation(): LayoutAnimationController | null {
        const timeline = new LayoutTimeline(this.board);

        if (!timeline.total_buckets) {
            return null;
        }

        this.#animation_timeline = timeline;
        timeline.current_time = 0;

        this.repaint_preserving_layer_state();

        this.#animation_controller = new LayoutAnimationController(
            this,
            timeline,
        );
        this.#animation_controller.seek(0);
        return this.#animation_controller;
    }

    /**
     * Turns the layout animation off, returning to a statically painted
     * board.
     */
    disable_layout_animation() {
        if (!this.#animation_timeline) {
            return;
        }
        this.#animation_controller?.dispose();
        this.#animation_controller = null;
        this.#animation_timeline = null;
        this.paint();
        this.draw();
    }

    protected override create_layer_set() {
        return new LayerSet(this.board, this.theme);
    }
    public override paint() {
        const order = this.layers
            ? Array.from(
                  (this.layers as LayerSet).in_ui_order(),
                  (layer) => layer.name,
              )
            : null;
        super.paint();
        if (!this.layers) return;
        const available = Array.from(
            (this.layers as LayerSet).in_ui_order(),
            (layer) => layer.name,
        );
        if (
            order &&
            order.length === available.length &&
            order.every((name) => available.includes(name))
        ) {
            (this.layers as LayerSet).set_ui_order(order);
        }
        this.apply_object_opacities();
    }

    protected override get grid_origin() {
        return this.board.setup?.grid_origin ?? new Vec2(0, 0);
    }

    protected override on_pick(
        mouse: Vec2,
        items: Generator<{ layer: ViewLayer; bbox: BBox }, void, unknown>,
    ): void {
        const selectableItems = new Map<string, unknown>();
        for (const { bbox } of items) {
            const item = bbox.context;
            if (item instanceof board_items.Footprint) {
                selectableItems.set(`Footprint: ${item.reference}`, item);
            } else if (kicad_common.isNetInfo(item)) {
                selectableItems.set(`Net: ${item.netname}`, item);
            } else {
                console.log(item);
            }
        }

        if (selectableItems.size === 0) {
            this.select(null);
        } else if (selectableItems.size === 1 || !this.#contextMenuCallback) {
            this.handleItemClick(selectableItems.values().next().value);
        } else {
            const { x, y } = this.viewport.camera.world_to_screen(mouse);
            this.#contextMenuCallback(x, y, selectableItems, (selected) => {
                this.handleItemClick(selected);
            });
        }
    }

    handleItemClick(item: unknown) {
        if (item instanceof board_items.Footprint) {
            this.select(item);
        } else if (kicad_common.isNetInfo(item)) {
            this.highlight_net(kicad_common.getNetNumber(item));
        }
    }

    override select(item: board_items.Footprint | string | BBox | null) {
        // If item is a string, find the footprint by uuid or reference.
        if (is_string(item)) {
            item = this.board.find_footprint(item);
        }

        // If it's a footprint, use the footprint's nominal bounding box.
        if (item instanceof board_items.Footprint) {
            item = item.bbox;
        }

        super.select(item);
    }

    highlight_net(net: number) {
        this.painter.paint_net(this.board, net);
        this.draw();
    }

    private set_layers_opacity(
        layers: Iterable<ViewLayer>,
        opacity: number,
        draw = true,
    ) {
        const names = new Set(Array.from(layers, (layer) => layer.name));
        for (const layer of this.layers.in_order()) {
            if (names.has(base_layer_name(layer.name))) {
                layer.opacity = opacity;
            }
        }
        if (draw) {
            this.draw();
        }
    }

    private apply_object_opacities() {
        const layers = this.layers as LayerSet;
        this.set_layers_opacity(
            layers.copper_layers(),
            this.#track_opacity,
            false,
        );
        this.set_layers_opacity(layers.via_layers(), this.#via_opacity, false);
        this.set_layers_opacity(
            layers.zone_layers(),
            this.#zone_opacity,
            false,
        );
        this.set_layers_opacity(layers.pad_layers(), this.#pad_opacity, false);
        this.set_layers_opacity(
            layers.pad_hole_layers(),
            this.#pad_hole_opacity,
            false,
        );
        this.set_layers_opacity(
            layers.grid_layers(),
            this.#grid_opacity,
            false,
        );
        const page = layers.by_name(LayerNames.drawing_sheet);
        if (page) {
            page.opacity = this.#page_opacity;
        }
    }

    set track_opacity(value: number) {
        this.#track_opacity = value;
        this.set_layers_opacity(
            (this.layers as LayerSet).copper_layers(),
            value,
        );
    }

    set via_opacity(value: number) {
        this.#via_opacity = value;
        this.set_layers_opacity((this.layers as LayerSet).via_layers(), value);
    }

    set zone_opacity(value: number) {
        this.#zone_opacity = value;
        this.set_layers_opacity((this.layers as LayerSet).zone_layers(), value);
    }

    set pad_opacity(value: number) {
        this.#pad_opacity = value;
        this.set_layers_opacity((this.layers as LayerSet).pad_layers(), value);
    }

    set pad_hole_opacity(value: number) {
        this.#pad_hole_opacity = value;
        this.set_layers_opacity(
            (this.layers as LayerSet).pad_hole_layers(),
            value,
        );
    }

    set grid_opacity(value: number) {
        this.#grid_opacity = value;
        this.set_layers_opacity((this.layers as LayerSet).grid_layers(), value);
    }

    set page_opacity(value: number) {
        this.#page_opacity = value;
        this.layers.by_name(LayerNames.drawing_sheet)!.opacity = value;
        this.draw();
    }

    get sketch_modes(): Readonly<BoardSketchModes> {
        return this.#sketch_modes;
    }

    get visible_modes(): Readonly<BoardVisibleModes> {
        return this.#visible_modes;
    }

    visible_for(object: BoardVisibleType): boolean {
        return this.#visible_modes[object];
    }

    set_visible(object: BoardVisibleType, value: boolean) {
        if (value === this.#visible_modes[object]) return;
        this.#visible_modes[object] = value;

        if (object === "grid" || object === "page") {
            const layer_name =
                object === "grid" ? LayerNames.grid : LayerNames.drawing_sheet;
            this.layers.by_name(layer_name)!.visible = value;
            this.draw();
            return;
        }

        this.repaint_preserving_layer_state();
    }

    sketch_mode_for(object: BoardObjectType): boolean {
        return this.#sketch_modes[object];
    }

    set_sketch_mode(object: BoardObjectType, value: boolean) {
        if (value === this.#sketch_modes[object]) {
            return;
        }

        this.#sketch_modes[object] = value;
        this.repaint_preserving_layer_state();
    }

    private repaint_preserving_layer_state() {
        const opacities = new Map(
            Array.from(this.layers.in_order(), (layer) => [
                layer.name,
                layer.opacity,
            ]),
        );
        const ui_layers = Array.from((this.layers as LayerSet).in_ui_order());
        const visibility = new Map(
            ui_layers.map((layer) => [layer.name, layer.visible]),
        );
        const highlighted = ui_layers.find((layer) => layer.highlighted)?.name;

        this.paint();

        for (const layer of this.layers.in_order()) {
            layer.opacity = opacities.get(layer.name) ?? layer.opacity;
        }
        for (const layer of (this.layers as LayerSet).in_ui_order()) {
            layer.visible = visibility.get(layer.name) ?? layer.visible;
        }
        if (highlighted) {
            this.layers.highlight(highlighted);
        }
        if (this.#animation_controller) {
            this.#animation_controller.seek(this.#animation_controller.time);
        } else {
            this.draw();
        }
    }

    zoom_to_board() {
        const edge_cuts = this.layers.by_name(LayerNames.edge_cuts)!;
        const board_bbox = edge_cuts.bbox;
        this.viewport.camera.bbox = board_bbox.grow(board_bbox.w * 0.1);
    }
}
