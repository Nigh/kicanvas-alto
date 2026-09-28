/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/**
 * Playback controls for the layout process animation. The Animation activity
 * temporarily applies the Physical layer preset and restores the user's layer
 * visibility when they leave the activity.
 */

import { delegate } from "../../../base/events";
import { KiCanvasLoadEvent } from "../../../viewers/base/events";
import { css, html } from "../../../base/web-components";
import { KCUIElement, type KCUIRangeElement } from "../../../kc-ui";
import type { LayoutAnimationController } from "../../../viewers/board/animation";
import { LayerNames, LayerSet } from "../../../viewers/board/layers";
import type { BoardViewer } from "../../../viewers/board/viewer";

export class KCBoardAnimationPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            .section {
                display: flex;
                flex-direction: column;
                gap: 0.5em;
            }

            h2 {
                margin: 0;
                font-size: 0.9em;
                font-weight: 600;
                line-height: 1.3;
            }

            .playback-row {
                display: flex;
                align-items: center;
                gap: 0.5em;
            }

            .playback-row kc-ui-button {
                flex: 0 0 auto;
            }

            .playback-row kc-ui-range {
                flex: 1 1 auto;
                min-width: 0;
            }

            .status {
                color: var(--panel-fg);
                font-size: 0.85em;
                font-variant-numeric: tabular-nums;
                overflow-wrap: anywhere;
            }
        `,
    ];

    viewer: BoardViewer;
    animation: LayoutAnimationController | null = null;
    #activity_observer: MutationObserver | null = null;
    #saved_layer_visibility: Map<string, boolean> | null = null;
    #events_setup = false;

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
            this.setup_events();
            const activity = this.closest("kc-ui-activity");
            if (activity) {
                this.#activity_observer = new MutationObserver(() => {
                    if (activity.hasAttribute("active")) {
                        this.apply_physical_preset();
                    } else {
                        this.reset_animation();
                    }
                });
                this.#activity_observer.observe(activity, {
                    attributes: true,
                    attributeFilter: ["active"],
                });
                if (activity.hasAttribute("active")) {
                    this.apply_physical_preset();
                }
            }
        })();
    }
    override disconnectedCallback() {
        this.#activity_observer?.disconnect();
        this.reset_animation();
        super.disconnectedCallback();
    }

    private setup_events() {
        if (this.#events_setup) return;
        this.#events_setup = true;

        delegate(this.renderRoot, "kc-ui-button", "click", (_event, source) => {
            if (source.getAttribute("name") !== "play") return;
            if (this.animation?.playing) {
                this.animation.pause();
            } else {
                this.ensure_animation()?.play();
            }
            this.update_ui();
        });

        this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
            this.#saved_layer_visibility = null;
            this.reset_animation();
            if (this.closest("kc-ui-activity")?.hasAttribute("active")) {
                this.apply_physical_preset();
            }
        });

        delegate(this.renderRoot, "kc-ui-range", "kc-ui-range:input", (e) => {
            const control = e.target as KCUIRangeElement;
            if (control.name == "time") {
                const progress = control.valueAsNumber;
                this.ensure_animation()?.pause();
                this.animation?.seek_progress(progress);
            }
        });
    }

    private ensure_animation() {
        if (!this.animation) {
            this.animation = this.viewer.enable_layout_animation();
            if (this.animation) {
                (this.viewer.layers as LayerSet).apply_preset("physical");
                this.viewer.draw();
                this.animation.on_change = () => this.update_ui();
            }
        }
        return this.animation;
    }

    private apply_physical_preset() {
        if (this.#saved_layer_visibility) return;

        const layers = this.viewer.layers as LayerSet;
        this.#saved_layer_visibility = new Map(
            [
                ...layers.in_ui_order(),
                layers.by_name(LayerNames.grid)!,
                layers.by_name(LayerNames.drawing_sheet)!,
            ].map((layer) => [layer.name, layer.visible]),
        );
        layers.apply_preset("physical");
        this.viewer.draw();
    }

    private reset_animation() {
        const saved_visibility = this.#saved_layer_visibility;
        if (saved_visibility) {
            const layers = this.viewer.layers as LayerSet;
            for (const [name, visible] of saved_visibility) {
                layers.by_name(name)!.visible = visible;
            }
            this.#saved_layer_visibility = null;
        }

        if (!this.animation) {
            if (saved_visibility) this.viewer.draw();
            return;
        }
        this.animation.on_change = null;
        this.viewer.disable_layout_animation();
        this.animation = null;
        this.update_ui();
    }

    private update_ui() {
        const play_button = this.renderRoot.querySelector<HTMLElement>(
            'kc-ui-button[name="play"]',
        );
        if (play_button) {
            // Note: we update the label text, not the `icon` attribute -
            // mutating icon after render hits a bug in kc-ui-button.
            const playing = this.animation?.playing ?? false;
            play_button.textContent = playing ? "Pause" : "Play";
            play_button.setAttribute(
                "title",
                playing ? "Pause" : "Play layout animation",
            );
        }

        const time_range = this.renderRoot.querySelector<KCUIRangeElement>(
            'kc-ui-range[name="time"]',
        );
        if (time_range) {
            time_range.value = (this.animation?.progress ?? 0).toString();
        }

        const status = this.renderRoot.querySelector(".status");
        if (status) {
            if (this.animation) {
                const t = this.animation.time;
                const d = this.animation.duration;
                const phase = this.animation.timeline.phases.find(
                    (p) => t >= p.start && t < p.end,
                );
                status.textContent =
                    `${t.toFixed(1)}s / ${d.toFixed(1)}s` +
                    (phase ? ` - ${phase.name}` : "");
            } else {
                status.textContent = "Not animating";
            }
        }
    }

    override render() {
        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Layout animation"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <section class="section">
                        <h2>Playback</h2>
                        <div class="playback-row">
                            <kc-ui-button
                                name="play"
                                title="Play layout animation"
                                >Play</kc-ui-button
                            >
                            <kc-ui-range
                                name="time"
                                min="0"
                                max="1"
                                step="0.001"
                                value="0"></kc-ui-range>
                        </div>
                        <span class="status" aria-live="polite"
                            >Not animating</span
                        >
                    </section>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-board-animation-panel",
    KCBoardAnimationPanelElement,
);
