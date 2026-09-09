/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/**
 * Panel for the layout process animation: play/pause, a scrubbable
 * timeline, and SVG/video export. Layer visibility is taken from the
 * regular Layers panel, so the export matches what's on screen.
 */

import { delegate } from "../../../base/events";
import { html } from "../../../base/web-components";
import { KCUIElement, type KCUIRangeElement } from "../../../kc-ui";
import type { BoardViewer } from "../../../viewers/board/viewer";
import type { LayoutAnimationController } from "../../../viewers/board/animation";
import { export_layout_animation_svg } from "../../../viewers/board/export-svg";
import { initiate_download } from "../../../base/dom/download";

export class KCBoardAnimationPanelElement extends KCUIElement {
    viewer: BoardViewer;
    animation: LayoutAnimationController | null = null;

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
            this.setup_events();
        })();
    }

    private setup_events() {
        delegate(this.renderRoot, "kc-ui-button", "click", (e) => {
            const name = (e.target as HTMLElement).getAttribute("name");
            switch (name) {
                case "play":
                    this.toggle_animation();
                    break;
                case "export-svg":
                    this.export_svg();
                    break;
                case "export-video":
                    this.export_video();
                    break;
            }
        });

        delegate(this.renderRoot, "kc-ui-range", "kc-ui-range:input", (e) => {
            const control = e.target as KCUIRangeElement;
            if (control.name == "time" && this.animation) {
                this.animation.pause();
                this.animation.seek_progress(control.valueAsNumber);
            }
        });
    }

    private toggle_animation() {
        if (this.animation) {
            this.animation.toggle();
        } else {
            const animation = this.viewer.enable_layout_animation();
            if (!animation) {
                return;
            }
            this.animation = animation;
            animation.on_change = () => this.update_ui();
            animation.play();
        }
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
        if (time_range && this.animation) {
            time_range.value = this.animation.progress.toString();
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

    private export_svg() {
        const svg = export_layout_animation_svg(
            this.viewer.board,
            this.viewer.layers,
            this.viewer.theme,
        );
        const file = new File([svg], "layout-animation.svg", {
            type: "image/svg+xml",
        });
        initiate_download(file);
    }

    private async export_video() {
        const animation = this.viewer.layout_animation;
        if (!animation) {
            return;
        }
        const file = await animation.record_video();
        if (file) {
            initiate_download(file);
        }
    }

    override render() {
        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Layout animation"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <kc-ui-control-list>
                        <kc-ui-control>
                            <label>Playback</label>
                            <kc-ui-button
                                name="play"
                                title="Play layout animation"
                                >Play</kc-ui-button
                            >
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Time</label>
                            <kc-ui-range
                                name="time"
                                min="0"
                                max="1"
                                step="0.001"
                                value="0"></kc-ui-range>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Status</label>
                            <span class="status">Not animating</span>
                        </kc-ui-control>
                    </kc-ui-control-list>
                </kc-ui-panel-body>
                <kc-ui-panel-title title="Export"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <kc-ui-control-list>
                        <kc-ui-control>
                            <label>Animated SVG</label>
                            <kc-ui-button
                                name="export-svg"
                                icon="image"
                                title="Export layout animation as SVG"></kc-ui-button>
                        </kc-ui-control>
                        <kc-ui-control>
                            <label>Video</label>
                            <kc-ui-button
                                name="export-video"
                                icon="movie"
                                title="Record layout animation as video"></kc-ui-button>
                        </kc-ui-control>
                    </kc-ui-control-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-board-animation-panel",
    KCBoardAnimationPanelElement,
);
