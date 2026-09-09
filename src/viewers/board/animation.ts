/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/**
 * Layout process animation for the board viewer.
 *
 * Simulates a human layout workflow: footprints are placed first, then
 * tracks and vias are routed net by net, and finally zones are poured
 * from the bottom copper layer up (so top pours never cover bottom ones).
 *
 * The timeline divides all animatable items into a fixed number of
 * buckets. The painter draws each bucket into its own view layer, so
 * playing or scrubbing the animation is just a matter of toggling layer
 * visibility - no repainting is needed.
 */

import {
    ArcSegment,
    Footprint,
    LineSegment,
    Via,
    Zone,
    type KicadPCB,
} from "../../kicad/board";
import type { Vec2 } from "../../base/math";
import {
    CopperLayerNames,
    CopperVirtualLayerNames,
    virtual_layer_for,
} from "./layers";
import type { BoardViewer } from "./viewer";

/** Name of the view layer holding the given bucket of a parent layer. */
export function bucket_layer_name(parent_name: string, bucket: number) {
    return `${parent_name}@anim:${bucket}`;
}

/** The parent (non-bucket) layer name for a possibly-bucketed layer name. */
export function base_layer_name(name: string) {
    const i = name.indexOf("@anim:");
    return i < 0 ? name : name.slice(0, i);
}

/** The bucket index encoded in a bucket layer name, or null. */
export function bucket_of(name: string): number | null {
    const i = name.indexOf("@anim:");
    return i < 0 ? null : Number(name.slice(i + 6));
}

export interface AnimationPhase {
    name: "footprints" | "routing" | "pours";
    /** Seconds into the animation at which this phase starts. */
    start: number;
    /** Seconds into the animation at which this phase ends. */
    end: number;
}

type RouteItem = LineSegment | ArcSegment | Via;

export class LayoutTimeline {
    readonly board: KicadPCB;

    /** Total animation length in seconds. May be changed at any time. */
    duration: number;

    /**
     * Buckets whose start time is at or before this are shown. View layer
     * visibility closures read this on every draw. Infinity shows everything.
     */
    current_time = Infinity;

    #item_buckets = new Map<unknown, number>();
    #zone_buckets = new Map<Zone, Map<string, number>>();
    #total_buckets = 0;
    #phases: AnimationPhase[] = [];

    /**
     * Time is allocated by the area an item changes on screen: small vias
     * get a blink, large parts linger, and big copper pours stretch out.
     * Each bucket gets a weight (sum of its items' weights) and time is
     * sliced proportional to the running weight total.
     */
    #bucket_weights: number[] = [];
    #weight_prefix: number[] = [0];
    #total_weight = 0;

    constructor(
        board: KicadPCB,
        options: { duration?: number; max_buckets?: number } = {},
    ) {
        this.board = board;
        this.duration = options.duration ?? 10;
        const max_buckets = options.max_buckets ?? 256;
        this.#build(max_buckets);
    }

    get total_buckets() {
        return this.#total_buckets;
    }

    get phases(): AnimationPhase[] {
        return this.#phases;
    }

    /**
     * The animation bucket for the given item on the given view layer, or
     * null if the item isn't animated and should always be shown.
     */
    bucket_for(item: unknown, view_layer_name: string): number | null {
        const zone_buckets = this.#zone_buckets.get(item as Zone);
        if (zone_buckets) {
            return zone_buckets.get(view_layer_name) ?? null;
        }
        return this.#item_buckets.get(item) ?? null;
    }

    /** The time in seconds at which the given bucket starts appearing. */
    time_for_bucket(bucket: number): number {
        if (!this.#total_buckets || !this.#total_weight) {
            return 0;
        }
        return (
            ((this.#weight_prefix[bucket] ?? 0) / this.#total_weight) *
            this.duration
        );
    }

    /** The time in seconds at which the given bucket has fully appeared. */
    bucket_end_time(bucket: number): number {
        if (!this.#total_buckets || !this.#total_weight) {
            return 0;
        }
        return (
            ((this.#weight_prefix[bucket + 1] ?? this.#total_weight) /
                this.#total_weight) *
            this.duration
        );
    }

    /**
     * How long a bucket spends fading in. Scaled to the bucket's own
     * duration so tiny buckets blink and huge pours ease in, but capped.
     */
    fade_duration(bucket: number): number {
        const span =
            this.bucket_end_time(bucket) - this.time_for_bucket(bucket);
        return Math.min(0.35, Math.max(0.08, span * 0.6));
    }

    /** The opacity of the given bucket at time t (0..1). */
    opacity_for(bucket: number, t: number): number {
        const start = this.time_for_bucket(bucket);
        if (t <= start) {
            return 0;
        }
        const fade = this.fade_duration(bucket);
        if (fade <= 0) {
            return 1;
        }
        return Math.min(1, (t - start) / fade);
    }

    #build(max_buckets: number) {
        const footprints = order_footprints(this.board);
        const routes = order_routes(this.board);
        const pours = order_pours(this.board);

        const total_items = footprints.length + routes.length + pours.length;
        if (!total_items) {
            return;
        }

        // Zones pour per (zone, layer) pair; split a zone's weight evenly
        // across its pairs.
        const zone_pair_count = new Map<Zone, number>();
        for (const [zone] of pours) {
            zone_pair_count.set(zone, (zone_pair_count.get(zone) ?? 0) + 1);
        }

        const bucket_count = Math.min(max_buckets, total_items);
        const names: AnimationPhase["name"][] = [
            "footprints",
            "routing",
            "pours",
        ];

        this.#bucket_weights = new Array(bucket_count).fill(0);

        let start_bucket = 0;
        const phases: {
            name: AnimationPhase["name"];
            start_bucket: number;
            buckets: number;
        }[] = [];

        const assign = <T>(
            phase_index: number,
            items: T[],
            set: (item: T, bucket: number) => void,
            weight_of: (item: T) => number,
        ) => {
            if (!items.length) {
                return;
            }
            const buckets = Math.max(
                1,
                Math.floor((bucket_count * items.length) / total_items),
            );
            for (let i = 0; i < items.length; i++) {
                const bucket =
                    start_bucket + Math.floor((i * buckets) / items.length);
                set(items[i]!, bucket);
                this.#bucket_weights[bucket]! += weight_of(items[i]!);
            }
            phases.push({
                name: names[phase_index]!,
                start_bucket,
                buckets,
            });
            start_bucket += buckets;
        };

        assign(
            0,
            footprints,
            (fp, b) => this.#item_buckets.set(fp, b),
            (fp) => item_weight(fp),
        );
        assign(
            1,
            routes,
            (item, b) => this.#item_buckets.set(item, b),
            (item) => item_weight(item),
        );
        assign(
            2,
            pours,
            ([zone, view_layer], b) => {
                let zone_map = this.#zone_buckets.get(zone);
                if (!zone_map) {
                    zone_map = new Map();
                    this.#zone_buckets.set(zone, zone_map);
                }
                zone_map.set(view_layer, b);
            },
            ([zone]) => item_weight(zone) / (zone_pair_count.get(zone) ?? 1),
        );

        this.#total_buckets = start_bucket;
        this.#total_weight = this.#bucket_weights.reduce((a, b) => a + b, 0);

        this.#weight_prefix = [0];
        for (const w of this.#bucket_weights) {
            this.#weight_prefix.push(this.#weight_prefix.at(-1)! + w);
        }

        this.#phases = phases.map((p, i) => ({
            name: p.name,
            start: this.time_for_bucket(p.start_bucket),
            end:
                i + 1 < phases.length
                    ? this.time_for_bucket(phases[i + 1]!.start_bucket)
                    : this.duration,
        }));
    }
}

/**
 * The on-screen area an item changes, in mm², used to weight its
 * animation duration.
 */
function item_area(
    item: Footprint | LineSegment | ArcSegment | Via | Zone,
): number {
    if (item instanceof Footprint) {
        const bb = item.bbox;
        return bb.w * bb.h;
    }
    if (item instanceof Via) {
        return Math.PI * (item.size / 2) * (item.size / 2);
    }
    if (item instanceof Zone) {
        let area = 0;
        for (const p of item.filled_polygons ?? []) {
            area += polygon_area(p.polyline);
        }
        return area;
    }
    // LineSegment | ArcSegment: length × width.
    const length = item.end.sub(item.start).magnitude;
    return length * (item.width || 0.2);
}

function polygon_area(pts: Vec2[]): number {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        area += p.x * q.y - q.x * p.y;
    }
    return Math.abs(area) / 2;
}

/**
 * ponytail: sqrt flattens the area range so a board-sized pour doesn't
 * swallow the whole timeline, while still outlasting a single via. Upgrade
 * path: expose a per-phase power/scale knob if the default pacing feels off.
 */
function item_weight(
    item: Footprint | LineSegment | ArcSegment | Via | Zone,
): number {
    return Math.sqrt(Math.max(item_area(item), 0.04));
}

/** Placement order: front side first, larger parts before smaller ones. */
function order_footprints(board: KicadPCB): Footprint[] {
    const area = (fp: Footprint) => {
        const bb = fp.bbox;
        const a = bb.w * bb.h;
        return Number.isFinite(a) ? a : 0;
    };
    return [...board.footprints].sort((a, b) => {
        const side_a = a.layer === "B.Cu" ? 1 : 0;
        const side_b = b.layer === "B.Cu" ? 1 : 0;
        return (
            side_a - side_b ||
            area(b) - area(a) ||
            a.reference.localeCompare(b.reference)
        );
    });
}

/**
 * Routing order: net by net (largest first), items within a net chained by
 * connectivity.
 *
 * ponytail: greedy DFS walk over shared endpoints approximates the order a
 * human routed in; the file doesn't record true routing order. Upgrade path:
 * none possible without heuristics getting much fancier (e.g. pad-to-pad
 * shortest paths).
 */
function order_routes(board: KicadPCB): RouteItem[] {
    const by_net = new Map<number, RouteItem[]>();
    for (const item of [...board.segments, ...board.vias] as RouteItem[]) {
        let group = by_net.get(item.net);
        if (!group) {
            group = [];
            by_net.set(item.net, group);
        }
        group.push(item);
    }

    const groups = [...by_net.entries()].sort(
        (a, b) => b[1].length - a[1].length || a[0] - b[0],
    );

    return groups.flatMap(([, items]) => chain_order(items));
}

function chain_order(items: RouteItem[]): RouteItem[] {
    const endpoints = (item: RouteItem): Vec2[] =>
        "at" in item ? [item.at.position] : [item.start, item.end];
    const key = (p: Vec2) =>
        `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

    const by_point = new Map<string, number[]>();
    items.forEach((item, i) => {
        for (const p of endpoints(item)) {
            const k = key(p);
            let list = by_point.get(k);
            if (!list) {
                list = [];
                by_point.set(k, list);
            }
            list.push(i);
        }
    });

    const visited = new Set<number>();
    const out: RouteItem[] = [];

    for (let i = 0; i < items.length; i++) {
        if (visited.has(i)) {
            continue;
        }
        const stack = [i];
        while (stack.length) {
            const j = stack.pop()!;
            if (visited.has(j)) {
                continue;
            }
            visited.add(j);
            out.push(items[j]!);
            for (const p of endpoints(items[j]!)) {
                for (const k of by_point.get(key(p)) ?? []) {
                    if (!visited.has(k)) {
                        stack.push(k);
                    }
                }
            }
        }
    }

    return out;
}

/**
 * Pour order: bottom copper layer up to the top one, so that upper pours
 * can't cover lower ones as they appear. Within a layer, lower priority
 * zones first.
 */
function order_pours(board: KicadPCB): [Zone, string][] {
    const pairs: { zone: Zone; view_layer: string; index: number }[] = [];

    board.zones.forEach((zone, index) => {
        for (const view_layer of zone_view_layers(zone)) {
            pairs.push({ zone, view_layer, index });
        }
    });

    const copper_rank = (view_layer: string) => {
        // Bottom layers animate first: B.Cu has the highest index in
        // CopperLayerNames, so negate to sort bottom-up. Non-copper zone
        // layers go last (they're drawn on top of everything anyway).
        const cu = CopperLayerNames.find((name) => view_layer.includes(name));
        return cu === undefined ? Infinity : -CopperLayerNames.indexOf(cu);
    };

    pairs.sort(
        (a, b) =>
            copper_rank(a.view_layer) - copper_rank(b.view_layer) ||
            (a.zone.priority ?? 0) - (b.zone.priority ?? 0) ||
            a.index - b.index,
    );

    return pairs.map(({ zone, view_layer }) => [zone, view_layer]);
}

/** The view layers a zone paints on, mirroring ZonePainter.layers_for. */
function zone_view_layers(zone: Zone): string[] {
    const layers = [...(zone.layers ?? [zone.layer])];

    if (layers.length && layers[0] == "F&B.Cu") {
        layers.shift();
        layers.push("F.Cu", "B.Cu");
    }

    return layers.map((l) => {
        if (CopperLayerNames.includes(l as any)) {
            return virtual_layer_for(l, CopperVirtualLayerNames.zones);
        } else {
            return l;
        }
    });
}

/**
 * Drives playback of a LayoutTimeline on a BoardViewer.
 */
export class LayoutAnimationController {
    readonly timeline: LayoutTimeline;

    on_change: (() => void) | null = null;
    on_finish: (() => void) | null = null;

    #viewer: BoardViewer;
    #time = 0;
    #playing = false;
    #raf = 0;
    #last_ts = 0;
    #recording = false;

    constructor(viewer: BoardViewer, timeline: LayoutTimeline) {
        this.#viewer = viewer;
        this.timeline = timeline;
    }

    get duration() {
        return this.timeline.duration;
    }

    get time() {
        return this.#time;
    }

    get playing() {
        return this.#playing;
    }

    get recording() {
        return this.#recording;
    }

    get progress() {
        return this.duration ? this.#time / this.duration : 1;
    }

    seek(time: number) {
        this.#time = Math.max(0, Math.min(time, this.duration));
        this.timeline.current_time = this.#time;

        // Fade the currently-appearing bucket in; already-shown buckets get
        // full opacity. Bucket layers are found by name.
        for (const layer of this.#viewer.layers.in_order()) {
            const bucket = bucket_of(layer.name);
            if (bucket != null) {
                layer.opacity = this.timeline.opacity_for(bucket, this.#time);
            }
        }

        this.#viewer.draw();
        this.on_change?.();
    }

    seek_progress(progress: number) {
        this.seek(progress * this.duration);
    }

    play() {
        if (this.#playing) {
            return;
        }
        if (this.#time >= this.duration) {
            this.seek(0);
        }
        this.#playing = true;
        this.#last_ts = 0;
        this.on_change?.();

        const tick = (ts: number) => {
            if (!this.#playing) {
                return;
            }
            const dt = this.#last_ts ? (ts - this.#last_ts) / 1000 : 0;
            this.#last_ts = ts;
            this.seek(this.#time + dt);
            if (this.#time >= this.duration) {
                this.pause();
                this.on_finish?.();
            } else {
                this.#raf = requestAnimationFrame(tick);
            }
        };
        this.#raf = requestAnimationFrame(tick);
    }

    pause() {
        this.#playing = false;
        cancelAnimationFrame(this.#raf);
        this.on_change?.();
    }

    toggle() {
        if (this.#playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    dispose() {
        this.pause();
    }

    /**
     * Record the canvas while playing the animation back in real time.
     * Resolves to a video file (webm, or mp4 where supported).
     *
     * ponytail: records in real time at whatever the canvas shows; offline
     * frame-exact rendering would need an offscreen renderer and encoder.
     */
    async record_video(): Promise<File | null> {
        const canvas = this.#viewer.canvas;
        if (
            this.#recording ||
            typeof MediaRecorder === "undefined" ||
            !canvas.captureStream
        ) {
            return null;
        }

        const mime_type = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
            "video/mp4",
        ].find((m) => MediaRecorder.isTypeSupported(m));
        if (!mime_type) {
            return null;
        }

        this.#recording = true;
        try {
            const stream = canvas.captureStream(30);
            const recorder = new MediaRecorder(stream, {
                mimeType: mime_type,
            });
            const chunks: Blob[] = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size) {
                    chunks.push(e.data);
                }
            };
            const stopped = new Promise<void>((resolve) => {
                recorder.onstop = () => resolve();
            });
            const finished = new Promise<void>((resolve) => {
                this.on_finish = () => resolve();
            });

            recorder.start();
            this.seek(0);
            this.play();
            await finished;
            recorder.stop();
            await stopped;
            for (const track of stream.getTracks()) {
                track.stop();
            }

            const ext = mime_type.includes("mp4") ? "mp4" : "webm";
            return new File(chunks, `layout-animation.${ext}`, {
                type: mime_type,
            });
        } finally {
            this.#recording = false;
            this.on_finish = null;
        }
    }
}
