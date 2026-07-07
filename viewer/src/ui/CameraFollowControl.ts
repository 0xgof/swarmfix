export interface CameraFollowControlProps {
  followsBarycenter: boolean;
  onChange: (followsBarycenter: boolean) => void;
}

export function createCameraFollowControl(props: CameraFollowControlProps): HTMLElement {
  const label = document.createElement("label");
  label.className = "camera-follow-control";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "cameraFollowsSwarmBarycenter";
  checkbox.checked = props.followsBarycenter;
  checkbox.addEventListener("change", () => {
    props.onChange(checkbox.checked);
  });

  label.append(checkbox, "Follow swarm barycenter");
  return label;
}
