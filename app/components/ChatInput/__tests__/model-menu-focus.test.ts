import { focusSelectedModelOption } from "../model-menu-focus";

function menuWithSelection(top: number, bottom: number) {
  const menu = document.createElement("div");
  const option = document.createElement("button");
  option.dataset.selected = "true";
  menu.append(option);
  document.body.append(menu);
  menu.scrollTop = 100;
  jest
    .spyOn(menu, "getBoundingClientRect")
    .mockReturnValue({ top: 200, bottom: 400 } as DOMRect);
  jest
    .spyOn(option, "getBoundingClientRect")
    .mockReturnValue({ top, bottom } as DOMRect);
  const focus = jest.spyOn(option, "focus");
  const scrollIntoView = jest.fn();
  option.scrollIntoView = scrollIntoView;
  return { menu, option, focus, scrollIntoView };
}

afterEach(() => {
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

it.each([
  [240, 270, 100], // Already visible: don't move anything.
  [450, 480, 180], // Below: reveal only the missing part.
  [150, 180, 50], // Above: keep movement within the menu.
])(
  "reveals selection at %s..%s without scrolling its ancestors",
  (top, bottom, expected) => {
    const { menu, option, focus, scrollIntoView } = menuWithSelection(
      top,
      bottom,
    );
    focusSelectedModelOption(menu);
    expect(option).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(menu.scrollTop).toBe(expected);
    expect(scrollIntoView).not.toHaveBeenCalled();
  },
);

it("does not steal focus when there is no selected option", () => {
  const menu = document.createElement("div");
  const composer = document.createElement("textarea");
  document.body.append(menu, composer);
  composer.focus();
  focusSelectedModelOption(menu);
  expect(composer).toHaveFocus();
});
