export function canvasPointerPoint(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
  width: number,
  height: number,
  rotation: number,
) {
  const rect = element.getBoundingClientRect();
  const wrapper = element.closest('.react-transform-component');
  const matrix = wrapper
    ? new DOMMatrixReadOnly(getComputedStyle(wrapper).transform)
    : null;
  const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
  const x = event.clientX - rect.x - rect.width / 2;
  const y = event.clientY - rect.y - rect.height / 2;
  const angle = (rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    x:
      ((element.offsetWidth / 2 + (x * c + y * s) / scale) * width) /
      element.offsetWidth,
    y:
      ((element.offsetHeight / 2 + (-x * s + y * c) / scale) * height) /
      element.offsetHeight,
  };
}
