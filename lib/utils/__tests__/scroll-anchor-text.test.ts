import { scrollAnchorText } from "../scroll-anchor-text";

it("does not read the remainder of a large highlighted command block", () => {
  const block = document.createElement("pre");
  const start = document.createElement("span");
  start.textContent = "x".repeat(80);
  const tail = document.createTextNode("y".repeat(100000));
  block.append(start, tail);
  const aggregate = jest.spyOn(block, "textContent", "get");
  const remainder = jest.spyOn(tail, "nodeValue", "get");
  expect(scrollAnchorText(block)).toBe("x".repeat(80));
  expect(aggregate).not.toHaveBeenCalled();
  expect(remainder).not.toHaveBeenCalled();
});

it("retains a prefix across nested formatting and leading whitespace", () => {
  const block = document.createElement("p");
  block.innerHTML = "  <b>Merhaba</b> <em>dünya</em>  ";
  expect(scrollAnchorText(block)).toBe("Merhaba dünya");
});

it("identifies images by their source and accepts empty blocks", () => {
  const image = document.createElement("img");
  image.setAttribute("src", "/example.png");
  expect(scrollAnchorText(image)).toBe("/example.png");
  expect(scrollAnchorText(document.createElement("p"))).toBe("");
});
