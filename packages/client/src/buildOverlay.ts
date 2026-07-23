/** Screen-space Underground-style BUILD bar over a selected pad. */

export class BuildOverlay {
  readonly el: HTMLButtonElement;

  constructor(parent: HTMLElement, onClick: () => void) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "world-build-bar";
    this.el.innerHTML = `<span class="build-bar-label">BUILD</span>`;
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Build tower");
    parent.appendChild(this.el);
    this.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    this.el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
  }

  /** Position in viewport-local CSS pixels (parent is #viewport). */
  update(opts: {
    visible: boolean;
    x: number;
    y: number;
  }): void {
    if (!opts.visible) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.el.style.transform = `translate(-50%, -50%) translate(${opts.x}px, ${opts.y}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
