import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MailStatus } from "@mailvault/shared";
import { CopyButton, EmptyState, StatusPill } from "./ui";

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
