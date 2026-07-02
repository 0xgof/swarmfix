import "./primitives.css";

export interface PrimitiveComponent<Props> {
  element: HTMLElement;
  update: (props: Props) => void;
}

export interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}

export interface SliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface CheckboxGroupItem {
  key: string;
  label: string;
  checked: boolean;
}

export interface CheckboxGroupProps {
  items: CheckboxGroupItem[];
  onChange: (key: string, checked: boolean) => void;
}

export interface InfoRowProps {
  label: string;
  value: string;
}

export interface InfoPanelProps {
  title: string;
  rows: InfoRowProps[];
}

export interface StatusBadgeProps {
  label: string;
  tone: "ok" | "warn" | "error" | "neutral";
}

function setClass(element: HTMLElement,
                  baseClass: string,
                  modifier: string): void {
  element.className = `${baseClass} ${baseClass}--${modifier}`;
}

export function createButton(props: ButtonProps): PrimitiveComponent<ButtonProps> {
  const button = document.createElement("button");
  button.className = "primitive-button";
  button.addEventListener("click", () => props.onClick());
  const update = (nextProps: ButtonProps): void => {
    button.textContent = nextProps.label;
    button.disabled = nextProps.disabled ?? false;
    setClass(button, "primitive-button", nextProps.variant ?? "ghost");
  };
  update(props);
  return { element: button, update };
}

export function createSlider(props: SliderProps): PrimitiveComponent<SliderProps> {
  const label = document.createElement("label");
  label.className = "primitive-slider";
  const caption = document.createElement("span");
  const input = document.createElement("input");
  input.type = "range";
  const value = document.createElement("span");
  label.append(caption, input, value);
  input.addEventListener("input", () => {
    value.textContent = input.value;
    props.onChange(Number(input.value));
  });
  const update = (nextProps: SliderProps): void => {
    caption.textContent = nextProps.label;
    input.min = String(nextProps.min);
    input.max = String(nextProps.max);
    input.step = String(nextProps.step ?? 1);
    input.value = String(nextProps.value);
    value.textContent = String(nextProps.value);
    props = nextProps;
  };
  update(props);
  return { element: label, update };
}

export function createCheckbox(props: CheckboxProps): PrimitiveComponent<CheckboxProps> {
  const label = document.createElement("label");
  label.className = "primitive-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  const caption = document.createElement("span");
  label.append(input, caption);
  input.addEventListener("change", () => props.onChange(input.checked));
  const update = (nextProps: CheckboxProps): void => {
    caption.textContent = nextProps.label;
    input.checked = nextProps.checked;
    props = nextProps;
  };
  update(props);
  return { element: label, update };
}

export function createCheckboxGroup(props: CheckboxGroupProps): PrimitiveComponent<CheckboxGroupProps> {
  const container = document.createElement("div");
  container.className = "primitive-checkbox-group";
  const update = (nextProps: CheckboxGroupProps): void => {
    container.innerHTML = "";
    for (const item of nextProps.items) {
      const checkbox = createCheckbox({
        label: item.label,
        checked: item.checked,
        onChange: (checked) => nextProps.onChange(item.key, checked)
      });
      container.append(checkbox.element);
    }
    props = nextProps;
  };
  update(props);
  return { element: container, update };
}

export function createInfoRow(props: InfoRowProps): PrimitiveComponent<InfoRowProps> {
  const row = document.createElement("div");
  row.className = "primitive-info-row";
  const label = document.createElement("span");
  const value = document.createElement("strong");
  row.append(label, value);
  const update = (nextProps: InfoRowProps): void => {
    label.textContent = nextProps.label;
    value.textContent = nextProps.value;
  };
  update(props);
  return { element: row, update };
}

export function createInfoPanel(props: InfoPanelProps): PrimitiveComponent<InfoPanelProps> {
  const panel = document.createElement("section");
  panel.className = "primitive-info-panel";
  const title = document.createElement("h2");
  const rows = document.createElement("div");
  panel.append(title, rows);
  const update = (nextProps: InfoPanelProps): void => {
    title.textContent = nextProps.title;
    rows.innerHTML = "";
    for (const rowProps of nextProps.rows) {
      rows.append(createInfoRow(rowProps).element);
    }
  };
  update(props);
  return { element: panel, update };
}

export function createStatusBadge(props: StatusBadgeProps): PrimitiveComponent<StatusBadgeProps> {
  const badge = document.createElement("span");
  const update = (nextProps: StatusBadgeProps): void => {
    badge.textContent = nextProps.label;
    setClass(badge, "primitive-status-badge", nextProps.tone);
  };
  update(props);
  return { element: badge, update };
}
