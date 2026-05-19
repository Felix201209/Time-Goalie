import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cloneElement } from "react";

export function SortableTimeBlock({ block, style, activeWrapper, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      className={`time-block-wrapper ${activeWrapper ? "active-wrapper" : ""}`}
      style={{ ...style, ...dndStyle }}
    >
      {cloneElement(children, { dragHandleProps: { ...attributes, ...listeners } })}
    </div>
  );
}
