/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { css, html, query } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { Preferences } from "../../preferences";
import themes from "../../themes";
import { deserialize_theme, serialize_theme } from "../../themes/serialization";
import { initiate_download } from "../../../base/dom/download";

const prefs = Preferences.INSTANCE;

export class KCPreferencesPanel extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            select {
                box-sizing: border-box;
                display: block;
                width: 100%;
                max-width: 100%;
                margin-top: 0.25em;
                font-family: inherit;
                font-size: inherit;
                font-weight: 300;
                margin-top: 0.25em;
                border-radius: 0.25em;
                text-align: left;
                padding: 0.25em;
                background: var(--input-bg);
                color: var(--input-fg);
                border: var(--input-border);
                transition:
                    color var(--transition-time-medium) ease,
                    box-shadow var(--transition-time-medium) ease,
                    outline var(--transition-time-medium) ease,
                    background var(--transition-time-medium) ease,
                    border var(--transition-time-medium) ease;
            }

            select::after {
                display: block;
                content: "▾";
                color: var(--input-fg);
            }

            select:hover {
                z-index: 10;
                box-shadow: var(--input-hover-shadow);
            }

            select:focus {
                z-index: 10;
                box-shadow: none;
                outline: var(--input-focus-outline);
            }
        `,
    ];

    @query("[name=theme]", true)
    private theme_control!: HTMLSelectElement;

    override initialContentCallback() {
        this.renderRoot.addEventListener("input", (e) => {
            const target = e.target as HTMLInputElement;

            if (target.name === "theme") {
                prefs.theme = themes.by_name(this.theme_control.value);
            }
            if (target.name === "align-controls-kicad") {
                prefs.alignControlsWithKiCad = target.checked;
            }
            prefs.save();
        });

        this.renderRoot.addEventListener("click", (e) => {
            const button = (e.target as HTMLElement).closest("kc-ui-button");
            if (!button) {
                return;
            }
            switch (button.getAttribute("name")) {
                case "export-theme":
                    this.export_theme();
                    break;
                case "import-theme":
                    this.import_theme();
                    break;
            }
        });
    }

    private export_theme() {
        const json = serialize_theme(prefs.theme);
        initiate_download(
            new File([json], "kicanvas-theme.json", {
                type: "application/json",
            }),
        );
    }

    private import_theme() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                return;
            }
            try {
                prefs.theme = deserialize_theme(await file.text());
                prefs.save();
            } catch (e) {
                console.error("Unable to import theme", e);
            }
        };
        input.click();
    }

    override render() {
        const theme_options = themes.list().map((v) => {
            return html`<option
                value="${v.name}"
                selected="${prefs.theme.name == v.name}">
                ${v.friendly_name}
            </option>`;
        });

        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Preferences"></kc-ui-panel-title>
                <kc-ui-panel-body padded>
                    <kc-ui-control-list>
                        <kc-ui-control>
                            <label>Theme</label>
                            <select name="theme" value="kicad">
                                ${theme_options}
                            </select>
                        </kc-ui-control>
                    </kc-ui-control-list>
                    <kc-ui-control>
                        <label>Color theme</label>
                        <kc-ui-button name="export-theme"
                            >Export theme JSON</kc-ui-button
                        >
                        <kc-ui-button name="import-theme"
                            >Import theme JSON</kc-ui-button
                        >
                    </kc-ui-control>
                    <kc-ui-control>
                        <label>
                            <input
                                type="checkbox"
                                name="align-controls-kicad"
                                checked="${prefs.alignControlsWithKiCad}" />
                            Align controls with KiCad
                        </label>
                    </kc-ui-control>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define("kc-preferences-panel", KCPreferencesPanel);
