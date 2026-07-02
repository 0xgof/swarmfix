export const visualTokens = Object.freeze({
  color: Object.freeze({
    white: "#ffffff",
    offWhite: "#fbfbf8",
    black: "#111111",
    charcoal: "#2c2c2c",
    paleGrey: "#d8dce0",
    softGrey: "#aeb5bb",
    warmGrey: "#ece8df",
    amber: "#c79a3b",
    blue: "#547aa5"
  }),
  opacity: Object.freeze({
    faint: 0.08,
    subtle: 0.16,
    medium: 0.42,
    strong: 0.78,
    solid: 1.0
  }),
  markerSize: Object.freeze({
    truth: 0.16,
    measurement: 0.13,
    estimate: 0.18,
    reference: 0.22
  }),
  lineWidth: Object.freeze({
    hairline: 1,
    thin: 1.5,
    medium: 2.5,
    heavy: 4
  }),
  renderOrder: Object.freeze({
    construction: 0,
    uncertainty: 5,
    links: 10,
    residuals: 20,
    markers: 40,
    selected: 60
  }),
  spacing: Object.freeze({
    panelPaddingPx: 16,
    controlGapPx: 10
  })
});
