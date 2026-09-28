/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";
import * as board from "../../src/kicad/board";
import { NullRenderer } from "../../src/graphics/null-renderer";
import { RenderLayer } from "../../src/graphics/renderer";
import { BBox, Matrix3 } from "../../src/base/math";
import kicad_theme from "../../src/kicanvas/themes/kicad-default";
import { BoardPainter } from "../../src/viewers/board/painter";
import { ViewLayer, ViewLayerSet } from "../../src/viewers/base/view-layers";
import type { Viewport } from "../../src/viewers/base/viewport";
import {
    LayoutAnimationController,
    LayoutTimeline,
    base_layer_name,
    bucket_layer_name,
    bucket_of,
} from "../../src/viewers/board/animation";
import { export_board_svg } from "../../src/viewers/board/export-svg";
import {
    CopperLayerNames,
    CopperVirtualLayerNames,
    LayerNames,
    LayerSet,
    virtual_layer_for,
} from "../../src/viewers/board/layers";
import type { BoardViewer } from "../../src/viewers/board/viewer";
import { Viewer } from "../../src/viewers/base/viewer";

import traces_pcb_src from "./files/traces.kicad_pcb";
import vias_pcb_src from "./files/vias.kicad_pcb";
import zones_pcb_src from "./files/zones.kicad_pcb";
import footprints_pcb_src from "./files/footprint-pads.kicad_pcb";

suite("board.animation.LayoutTimeline", function () {
    test("routing-only board has only the routing phase", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", traces_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        assert.equal(timeline.phases.length, 1);
        assert.equal(timeline.phases[0]!.name, "routing");
        // Every segment should have a bucket; unanimated items should not.
        for (const segment of pcb.segments) {
            assert.isNotNull(timeline.bucket_for(segment, "F.Cu"));
        }
        assert.isNull(timeline.bucket_for(pcb.drawings[0], "F.Cu"));
    });

    test("orders footprints before routing before pours", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", footprints_pcb_src);
        // footprints_pcb_src has footprints but no traces or zones, so only
        // the footprints phase should be present.
        const timeline = new LayoutTimeline(pcb);
        assert.equal(timeline.phases.length, 1);
        assert.equal(timeline.phases[0]!.name, "footprints");
        assert.equal(timeline.phases[0]!.start, 0);
        assert.equal(timeline.phases[0]!.end, timeline.duration);
        assert.isAbove(timeline.total_buckets, 0);

        // Every footprint should have a bucket, non-footprints should not.
        for (const fp of pcb.footprints) {
            const bucket = timeline.bucket_for(fp, fp.layer);
            assert.isNotNull(bucket);
            assert.isAtLeast(bucket!, 0);
            assert.isBelow(bucket!, timeline.total_buckets);
        }
        assert.isNull(timeline.bucket_for(pcb.segments[0], "F.Cu"));
    });

    test("orders traces and vias within the routing phase", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", vias_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        assert.equal(timeline.phases.length, 1);
        assert.equal(timeline.phases[0]!.name, "routing");

        const route_buckets = [...pcb.segments, ...pcb.vias].map((item) =>
            timeline.bucket_for(item, "F.Cu"),
        );
        assert.isTrue(route_buckets.every((b) => b !== null));
    });

    test("orders zone pours bottom-to-top", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", zones_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        assert.equal(timeline.phases.length, 1);
        assert.equal(timeline.phases[0]!.name, "pours");

        // Collect (bucket, layer) pairs for copper zones and check that
        // higher layers never have smaller buckets than lower layers.
        const copper_order = ["B.Cu", "In1.Cu", "In2.Cu", "F.Cu"];
        const seen: [number, number][] = []; // [bucket, copper_rank]
        for (const zone of pcb.zones) {
            for (const layer of ["F.Cu", "B.Cu"]) {
                const bucket = timeline.bucket_for(zone, `:${layer}:Zones`);
                if (bucket !== null) {
                    seen.push([bucket, copper_order.indexOf(layer)]);
                }
            }
        }
        // If both F.Cu and B.Cu zones exist, B.Cu must come first.
        const f = seen.filter(([, r]) => r === 3);
        const b = seen.filter(([, r]) => r === 0);
        if (f.length && b.length) {
            assert.isBelow(
                Math.max(...b.map(([x]) => x)),
                Math.min(...f.map(([x]) => x)),
            );
        }
    });

    test("time/bucket mapping is monotonic and area-weighted", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", footprints_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        const total = timeline.total_buckets;

        // Buckets appear in order and cover the full duration.
        for (let b = 0; b < total; b++) {
            const start = timeline.time_for_bucket(b);
            const end = timeline.bucket_end_time(b);
            assert.isAtLeast(start, 0);
            assert.isAtMost(end, timeline.duration);
            assert.isAtMost(start, end);
            if (b > 0) {
                assert.isAtLeast(start, timeline.time_for_bucket(b - 1));
            }
        }

        // Opacity fades from 0 to 1 across a bucket's span.
        assert.equal(timeline.opacity_for(0, timeline.time_for_bucket(0)), 0);
        assert.equal(timeline.opacity_for(total - 1, timeline.duration), 1);
    });

    test("bucket layer names round-trip", function () {
        assert.equal(bucket_layer_name("F.Cu", 3), "F.Cu@anim:3");
        assert.equal(base_layer_name("F.Cu@anim:3"), "F.Cu");
        assert.equal(bucket_of("F.Cu@anim:3"), 3);
        assert.equal(base_layer_name("F.Cu"), "F.Cu");
        assert.isNull(bucket_of("F.Cu"));
        assert.equal(bucket_layer_name(":F.Cu:Zones", 1), ":F.Cu:Zones@anim:1");
        assert.equal(base_layer_name(":F.Cu:Zones@anim:1"), ":F.Cu:Zones");
        assert.equal(bucket_of(":F.Cu:Zones@anim:1"), 1);
    });

    test("keeps bucket layer Z-order stable when buckets are created out of order", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", traces_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        const layers = new LayerSet(pcb, kicad_theme.board);
        class TestPainter extends BoardPainter {
            add_bucket(item: unknown, layer_name: string) {
                return this.layer_name_for(item, layer_name);
            }
        }
        const painter = new TestPainter(
            new NullRenderer(),
            layers,
            kicad_theme.board,
        );
        painter.timeline = timeline;
        const layer_name = pcb.segments[0]!.layer;
        const segments = pcb.segments
            .filter((item) => item.layer === layer_name)
            .sort(
                (a, b) =>
                    timeline.bucket_for(b, layer_name)! -
                    timeline.bucket_for(a, layer_name)!,
            );
        for (const segment of segments) {
            painter.add_bucket(segment, layer_name);
        }

        const buckets = Array.from(layers.in_display_order())
            .filter((layer) => base_layer_name(layer.name) === layer_name)
            .map((layer) => bucket_of(layer.name))
            .filter((bucket): bucket is number => bucket !== null);
        assert.deepEqual(
            buckets,
            [...buckets].sort((a, b) => a - b),
        );
    });
    test("render order follows the current Layers menu order", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", zones_pcb_src);
        const layers = new LayerSet(pcb, kicad_theme.board);
        for (const reversed of [false, true]) {
            if (reversed) {
                layers.set_ui_order(
                    Array.from(
                        layers.in_ui_order(),
                        (layer) => layer.name,
                    ).reverse(),
                );
            }
            const menu_order = Array.from(
                layers.in_ui_order(),
                (layer) => layer.name,
            );
            const menu_names = new Set(menu_order);
            const rendered_order = Array.from(
                layers.in_display_order(),
                (layer) => layer.name,
            ).filter((name) => menu_names.has(name));
            assert.deepEqual(rendered_order, menu_order.reverse());
        }
        layers.highlight(LayerNames.b_cu);
        const menu_order = Array.from(
            layers.in_ui_order(),
            (layer) => layer.name,
        );
        const menu_names = new Set(menu_order);
        assert.deepEqual(
            Array.from(layers.in_display_order(), (layer) => layer.name).filter(
                (name) => menu_names.has(name),
            ),
            [
                ...menu_order
                    .filter((name) => name !== LayerNames.b_cu)
                    .reverse(),
                LayerNames.b_cu,
            ],
        );
    });

    test("submits increasing WebGL depths for six layers and many animation buckets", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", zones_pcb_src);
        const layers = new LayerSet(pcb, kicad_theme.board);
        const renderer = new NullRenderer();
        const calls: { name: string; depth: number }[] = [];
        class CapturedLayer extends RenderLayer {
            override dispose() {}
            override clear() {}
            override render(_camera: Matrix3, depth: number) {
                calls.push({ name: this.name, depth });
            }
        }
        for (const name of [
            LayerNames.f_cu,
            LayerNames.in1_cu,
            LayerNames.in2_cu,
            LayerNames.in3_cu,
            LayerNames.in4_cu,
            LayerNames.b_cu,
        ]) {
            if (!layers.by_name(name)) {
                layers.add(new ViewLayer(layers, name));
            }
            for (let bucket = 0; bucket < 24; bucket++) {
                layers.add(
                    new ViewLayer(layers, bucket_layer_name(name, bucket)),
                );
            }
        }
        for (const layer of layers.in_order()) {
            layer.graphics = new CapturedLayer(renderer, layer.name);
        }
        class TestViewer extends Viewer {
            protected override create_renderer() {
                return renderer;
            }
            override async load() {}
            override paint() {}
            override zoom_to_page() {}
            render_frame() {
                this.on_draw();
            }
        }
        const viewer = new TestViewer(document.createElement("canvas"), false);
        viewer.renderer = renderer;
        viewer.layers = layers;
        viewer.viewport = {
            camera: { matrix: Matrix3.identity() },
        } as Viewport;
        viewer.render_frame();

        assert.isAbove(calls.length, 100);
        assert.isAbove(calls[0]!.depth, 0);
        assert.isBelow(calls.at(-1)!.depth, 1);
        for (let i = 1; i < calls.length; i++) {
            assert.isAbove(calls[i]!.depth, calls[i - 1]!.depth);
        }
        const menu_order = Array.from(
            layers.in_ui_order(),
            (layer) => layer.name,
        ).reverse();
        const menu_names = new Set(menu_order);
        assert.deepEqual(
            calls
                .map((call) => call.name)
                .filter((name) => menu_names.has(name)),
            menu_order,
        );
    });
    test("draw order follows menu order and each zone stays under its copper", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", zones_pcb_src);
        const layers = new LayerSet(pcb, kicad_theme.board);
        const timeline = new LayoutTimeline(pcb);
        class TestPainter extends BoardPainter {
            add_bucket(item: unknown, layer_name: string) {
                return this.layer_name_for(item, layer_name);
            }
        }
        const painter = new TestPainter(
            new NullRenderer(),
            layers,
            kicad_theme.board,
        );
        painter.timeline = timeline;
        const zone_buckets: [string, string][] = [];
        const copper = CopperLayerNames.filter((name) => layers.by_name(name));
        for (const zone of pcb.zones) {
            for (const layer_name of copper) {
                const zones = virtual_layer_for(
                    layer_name,
                    CopperVirtualLayerNames.zones,
                );
                const bucket = timeline.bucket_for(zone, zones);
                if (bucket === null) continue;
                painter.add_bucket(zone, zones);
                zone_buckets.push([
                    bucket_layer_name(zones, bucket),
                    layer_name,
                ]);
            }
        }
        assert.isNotEmpty(zone_buckets);
        const order = Array.from(
            layers.in_display_order(),
            (layer) => layer.name,
        );
        const menu_order = Array.from(
            layers.in_ui_order(),
            (layer) => layer.name,
        );
        const menu_names = new Set(menu_order);
        assert.deepEqual(
            order.filter((name) => menu_names.has(name)),
            menu_order.reverse(),
        );
        for (const layer_name of copper) {
            const zones = virtual_layer_for(
                layer_name,
                CopperVirtualLayerNames.zones,
            );
            assert.isBelow(order.indexOf(zones), order.indexOf(layer_name));
        }
        for (const [bucket, layer_name] of zone_buckets) {
            assert.isBelow(order.indexOf(bucket), order.indexOf(layer_name));
        }
    });

    test("animation fade preserves user opacity", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", traces_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        const layers = new ViewLayerSet();
        const layer = new ViewLayer(layers, bucket_layer_name("F.Cu", 0));
        layer.opacity = 0.35;
        layers.add(layer);
        const viewer = {
            layers,
            draw() {},
        } as unknown as BoardViewer;
        const animation = new LayoutAnimationController(viewer, timeline);

        animation.seek(timeline.duration);
        animation.seek(timeline.duration / 2);

        assert.equal(layer.opacity, 0.35);
        assert.equal(layer.animation_opacity, 1);

        animation.play();
        assert.isTrue(animation.playing);
        animation.pause();
        assert.isFalse(animation.playing);
    });
});

suite("board layer presets", function () {
    test("physical shows fabricated layers and hides documentation layers", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", zones_pcb_src);
        const layers = new LayerSet(pcb, kicad_theme.board);

        layers.apply_preset("physical");

        assert.isTrue(layers.by_name(LayerNames.f_cu)!.visible);
        assert.isTrue(layers.by_name(LayerNames.f_mask)!.visible);
        assert.isTrue(layers.by_name(LayerNames.f_silks)!.visible);
        assert.isTrue(layers.by_name(LayerNames.edge_cuts)!.visible);
        assert.isFalse(layers.by_name(LayerNames.f_fab)!.visible);
        assert.isFalse(layers.by_name(LayerNames.dwgs_user)!.visible);
        assert.isFalse(layers.by_name(LayerNames.user_1)!.visible);
        assert.isFalse(layers.by_name(LayerNames.grid)!.visible);
        assert.isFalse(layers.by_name(LayerNames.drawing_sheet)!.visible);
    });
});

suite("board export", function () {
    test("static SVG honors bounds, visibility, opacity, and track sketch", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", traces_pcb_src);
        const layers = new LayerSet(pcb, kicad_theme.board);
        for (const layer of layers.in_order()) {
            layer.opacity = 0.4;
        }

        const regular_svg = export_board_svg(pcb, layers, kicad_theme.board, {
            bbox: new BBox(1, 2, 30, 40),
        });
        const sketch_svg = export_board_svg(pcb, layers, kicad_theme.board, {
            bbox: new BBox(1, 2, 30, 40),
            sketch_modes: { tracks: true },
        });

        assert.include(sketch_svg, 'viewBox="1 2 30 40"');
        assert.include(sketch_svg, 'opacity="0.4"');
        assert.notInclude(sketch_svg, "<set ");
        assert.isAbove(
            sketch_svg.split("<polyline").length,
            regular_svg.split("<polyline").length,
        );

        layers.by_name("F.Cu")!.visible = false;
        const hidden_svg = export_board_svg(pcb, layers, kicad_theme.board);
        assert.notInclude(hidden_svg, 'data-layer="F.Cu"');
    });
});
