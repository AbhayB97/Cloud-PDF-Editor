export const SIGNATURE_VARIANTS = [
  {
    id: "sig-allura",
    label: "Allura",
    cssFamily: "Signature-Allura",
    fontFile: "fonts/Allura-Regular.ttf",
    letterSpacing: 0.02,
    baselineOffset: -0.04
  },
  {
    id: "sig-dancingscript",
    label: "Dancing Script",
    cssFamily: "Signature-DancingScript",
    fontFile: "fonts/DancingScript-Regular.ttf",
    letterSpacing: 0.03,
    baselineOffset: -0.02
  },
  {
    id: "sig-greatvibes",
    label: "Great Vibes",
    cssFamily: "Signature-GreatVibes",
    fontFile: "fonts/GreatVibes-Regular.ttf",
    letterSpacing: 0.015,
    baselineOffset: -0.05
  },
  {
    id: "sig-pacifico",
    label: "Pacifico",
    cssFamily: "Signature-Pacifico",
    fontFile: "fonts/Pacifico-Regular.ttf",
    letterSpacing: 0.01,
    baselineOffset: -0.01
  },
  {
    id: "sig-satisfy",
    label: "Satisfy",
    cssFamily: "Signature-Satisfy",
    fontFile: "fonts/Satisfy-Regular.ttf",
    letterSpacing: 0.02,
    baselineOffset: -0.03
  },
  {
    id: "sig-yellowtail",
    label: "Yellowtail",
    cssFamily: "Signature-Yellowtail",
    fontFile: "fonts/Yellowtail-Regular.ttf",
    letterSpacing: 0.025,
    baselineOffset: -0.02
  }
];

export const SIGNATURE_LAYOUT = {
  paddingX: 10,
  paddingY: 6,
  minFontSize: 10
};

export function getSignatureVariant(fontId) {
  return SIGNATURE_VARIANTS.find((variant) => variant.id === fontId) ?? SIGNATURE_VARIANTS[0];
}
