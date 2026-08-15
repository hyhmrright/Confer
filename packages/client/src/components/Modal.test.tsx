import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const i18n = (await import('../i18n/index.js')).default;
const { Modal } = await import('./Modal.js');

await i18n.changeLanguage('en');
afterEach(cleanup);

// A trigger outside the dialog, so focus has somewhere to come from and return
// to — the two ends of the behaviour this component exists to provide.
function Harness({ open, onClose = () => {} }: { open: boolean; onClose?: () => void }) {
  return (
    <>
      <button type="button" data-testid="trigger">
        open
      </button>
      {open && (
        <Modal title="Test dialog" onClose={onClose}>
          <button type="button" data-testid="inside">
            inside
          </button>
        </Modal>
      )}
    </>
  );
}

const panel = () => screen.getByRole('dialog');

describe('Modal', () => {
  test('exposes dialog semantics with a name taken from the title', () => {
    render(<Harness open />);
    expect(panel().getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel().getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Test dialog');
  });

  test('gives the close button an accessible name', () => {
    render(<Harness open />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  // Not the first control: that is Close, and landing there turns a stray Enter
  // into an immediate dismissal of the dialog the user just opened.
  test('moves focus to the panel itself, not to the close button', () => {
    render(<Harness open />);
    expect(document.activeElement).toBe(panel());
  });

  test('Escape asks to close', () => {
    const onClose = mock(() => {});
    render(<Harness open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('returns focus to whatever opened it', () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();

    rerender(<Harness open />);
    expect(document.activeElement).toBe(panel());

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  // Without the trap, Tab walks straight out of the dialog and into the page
  // behind the backdrop, which is where this started.
  test('Tab past the last control cycles back to the first', () => {
    render(<Harness open />);
    const inside = screen.getByTestId('inside');
    inside.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  test('Shift+Tab off the panel enters the dialog at its last control', () => {
    render(<Harness open />);
    expect(document.activeElement).toBe(panel());

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(screen.getByTestId('inside'));
  });

  test('stops listening once closed, so Escape no longer fires', () => {
    const onClose = mock(() => {});
    const { rerender } = render(<Harness open onClose={onClose} />);
    rerender(<Harness open={false} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
