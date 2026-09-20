/** The numbered step badge, or a green checkmark once that step's precondition is met. */
export function StepBadge({ step, complete }: { step: number; complete?: boolean }) {
  return <span className={`step-badge${complete ? " complete" : ""}`}>{complete ? "✓" : step}</span>;
}

/** A step-numbered card heading -- badge + title, matching the `.step-header` layout used across step-driven pages. */
export function StepHeader({ step, complete, title }: { step: number; complete?: boolean; title: string }) {
  return (
    <div className="step-header">
      <StepBadge step={step} complete={complete} />
      <h3>{title}</h3>
    </div>
  );
}
