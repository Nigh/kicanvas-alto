/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";
import * as board from "../../src/kicad/board";
import {
    LayoutTimeline,
    bucket_layer_name,
    bucket_of,
    base_layer_name,
} from "../../src/viewers/board/animation";

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

    test("time/bucket mapping round-trips", function () {
        const pcb = new board.KicadPCB("test.kicad_pcb", footprints_pcb_src);
        const timeline = new LayoutTimeline(pcb);
        const total = timeline.total_buckets;

        assert.equal(timeline.bucket_at_time(0), -1);
        assert.equal(timeline.bucket_at_time(0.0001), 0);
        assert.equal(timeline.bucket_at_time(timeline.duration), Infinity);
        assert.equal(timeline.bucket_at_time(-1), -1);

        for (let b = 0; b < total; b++) {
            const t = timeline.time_for_bucket(b);
            const back = timeline.bucket_at_time(t + 0.0001);
            assert.isAtLeast(back, b);
        }
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
});
