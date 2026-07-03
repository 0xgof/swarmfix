export interface LinkCountProps {
  max: number;
  value: number;
  diagnostics?: {
    candidateLinkCount: number;
    selectedLinkCount: number;
    adaptiveSelectionEnabled: boolean;
  };
  onChange: (count: number) => void;
}

function diagnosticsText(diagnostics: LinkCountProps["diagnostics"]): string {
  if (!diagnostics) {
    return "";
  }

  const mode = diagnostics.adaptiveSelectionEnabled ? "adaptive" : "static";
  const text = (
    `${diagnostics.selectedLinkCount}/${diagnostics.candidateLinkCount}`
    + ` selected ${mode}`
  );
  return text;
}

export function createLinkCountControl(props: LinkCountProps): HTMLElement {
  const label = document.createElement("label");
  label.className = "link-count-control";
  label.textContent = "UWB links per drone";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(props.max);
  slider.value = String(props.value);

  const value = document.createElement("span");
  value.textContent = String(props.value);
  const diagnostics = document.createElement("span");
  diagnostics.className = "link-count-diagnostics";
  diagnostics.textContent = diagnosticsText(props.diagnostics);
  slider.addEventListener("input", () => {
    value.textContent = slider.value;
    props.onChange(Number(slider.value));
  });

  label.append(slider, value, diagnostics);
  return label;
}

export function updateLinkCountDiagnostics(control: HTMLElement,
                                           diagnostics: LinkCountProps["diagnostics"]): void {
  const diagnosticsSpan = control.querySelector<HTMLElement>(".link-count-diagnostics");
  if (!diagnosticsSpan) {
    return;
  }

  const text = diagnosticsText(diagnostics);
  if (diagnosticsSpan.textContent !== text) {
    diagnosticsSpan.textContent = text;
  }
}
