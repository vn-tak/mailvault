import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MailStatus } from "@mailvault/shared";
import { CopyButton, EmptyState, Menu, StatusPill } from "./ui";

describe("StatusPill", () => {
  it("renders a friendly label for known statuses", () => {
    render(<StatusPill status={MailStatus.Ready} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("falls back to the raw value for unknown statuses", () => {
    render(<StatusPill status="WEIRD" />);
    expect(screen.getByText("WEIRD")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows title and hint", () => {
    render(<EmptyState title="Nothing here" hint="Try adding one" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try adding one")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton text="hello@x.dev" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy hello@x.dev/i }));

    expect(writeText).toHaveBeenCalledWith("hello@x.dev");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});

describe("Menu", () => {
  it("opens from the trigger, fires the chosen item and closes", () => {
    const onSelect = vi.fn();
    render(<Menu items={[{ label: "Archive", onSelect }]} />);
    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();

    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes on Escape and on a pointer down outside", () => {
    render(
      <div>
        <Menu items={[{ label: "Archive", onSelect: () => undefined }]} />
        <button>outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "More" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("walks the items with the arrow keys", () => {
    render(<Menu items={[{ label: "Pin", onSelect: () => undefined }, { label: "Delete", danger: true, onSelect: () => undefined }]} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Pin" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Pin" })).toHaveFocus();
  });

  it("renders nothing when there is no secondary action left", () => {
    render(<Menu items={[]} />);
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });
});
