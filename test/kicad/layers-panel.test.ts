import { assert } from "chai";
import { provideLazyContext } from "../../src/base/web-components/context";
import { Color } from "../../src/base/color";
import type { BoardViewer } from "../../src/viewers/board/viewer";
import type { KCBoardLayersPanelElement } from "../../src/kicanvas/elements/kc-board/layers-panel";
import "../../src/kicanvas/elements/kc-board/layers-panel";

suite("board layers panel", function () {
    test("dragging a layer previews and commits its new order", async function () {
        const names = ["F.Cu", "B.Cu"];
        const layers = [
            {
                name: names[0],
                color: Color.white,
                visible: true,
                highlighted: false,
            },
            {
                name: names[1],
                color: Color.white,
                visible: true,
                highlighted: false,
            },
        ];
        const layer_set = {
            *in_ui_order() {
                for (const name of names) {
                    yield layers.find((layer) => layer.name === name)!;
                }
            },
            set_ui_order(order: string[]) {
                names.splice(0, names.length, ...order);
            },
            by_name(name: string) {
                return layers.find((layer) => layer.name === name);
            },
            highlight(layer: (typeof layers)[number] | null) {
                layers.forEach((item) => (item.highlighted = item === layer));
            },
        };
        const viewer = {
            loaded: Promise.resolve(),
            layers: layer_set,
            draw() {},
        } as unknown as BoardViewer;
        const container = document.createElement("div");
        container.style.width = "300px";
        container.style.height = "300px";
        provideLazyContext(container, "viewer", () => viewer);
        const panel = document.createElement(
            "kc-board-layers-panel",
        ) as KCBoardLayersPanelElement;
        container.append(panel);
        document.body.append(container);

        try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const body = panel.shadowRoot!.querySelector("kc-ui-panel-body")!;
            const items = () =>
                Array.from(body.querySelectorAll("kc-board-layer-control"));
            const handle = items()[0]!.shadowRoot!.querySelector(".focus")!;
            const source = handle.getBoundingClientRect();
            const target = items()[1]!.getBoundingClientRect();
            const y = Math.round(source.top + source.height / 2);
            body.setPointerCapture = () => {};
            handle.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    composed: true,
                    button: 0,
                    clientY: y,
                }),
            );
            body.dispatchEvent(
                new PointerEvent("pointermove", { clientY: y + 6, buttons: 1 }),
            );
            body.dispatchEvent(
                new PointerEvent("pointermove", {
                    clientY: Math.round(target.bottom - 2),
                    buttons: 1,
                }),
            );
            assert.deepEqual(
                items().map((item) => item.getAttribute("layer-name")),
                ["B.Cu", "F.Cu"],
            );
            assert.deepEqual(names, ["F.Cu", "B.Cu"]);
            body.dispatchEvent(new PointerEvent("pointerup"));
            assert.deepEqual(names, ["B.Cu", "F.Cu"]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            items()[1]!
                .shadowRoot!.querySelector<HTMLButtonElement>(".focus")!
                .click();
            assert.isTrue(layers[0]!.highlighted);
        } finally {
            container.remove();
        }
    });
});
