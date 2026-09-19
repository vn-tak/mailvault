import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextBody } from "./TextBody";

/*
 * Body text is hostile input. These check both directions of the failure: the layout that
 * must survive (indented blocks, hard line breaks) and the markup that must not (an <img>
 * tag written in a mail body stays a string), plus a URL that ends a sentence must not
 * swallow the full stop into its href.
 */

describe("TextBody", () => {
  it("splits blank-line separated paragraphs and keeps the line breaks inside them", () => {
    const { container } = render(<TextBody text={"Your code is 123456\nIt expires in 10 minutes.\n\nThanks,\nExample"} />);
    expect(container.querySelectorAll(".text-para")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(2); // one per wrapped line, not after the last
    expect(screen.getByText("Your code is 123456")).toBeInTheDocument();
    expect(screen.getByText("It expires in 10 minutes.")).toBeInTheDocument();
  });

  it("keeps an indented block monospaced instead of reflowing it", () => {
    const { container } = render(
      <TextBody text={"Order:\n  item     qty\n  widget     2\n  bolt       7\n\nShipped today."} />,
    );
    const pre = container.querySelector("pre.text-plain");
    expect(pre?.textContent).toContain("  widget     2");
    expect(container.querySelectorAll(".text-para")).toHaveLength(1);
    expect(screen.getByText("Shipped today.")).toBeInTheDocument();
  });

  it("linkifies a bare address without swallowing the sentence's full stop", () => {
    render(<TextBody text={"Confirm at https://accounts.example.com/verify?token=abc123. This expires soon."} />);
    const link = screen.getByRole("link", { name: "https://accounts.example.com/verify?token=abc123" });
    expect(link).toHaveAttribute("href", "https://accounts.example.com/verify?token=abc123");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/This expires soon\./)).toBeInTheDocument();
  });

  it("keeps a balanced parenthesis inside the link", () => {
    render(<TextBody text={"See https://x.example.com/compare(a,b) for details"} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://x.example.com/compare(a,b)");
  });

  it("never renders email text as markup", () => {
    const { container } = render(<TextBody text={'<img src=x onerror="alert(1)"> <a href="javascript:1">click</a>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("ignores non-http schemes when linkifying", () => {
    const { container } = render(<TextBody text={"Reply to mailto:someone@example.com to continue"} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText(/mailto:someone@example\.com/)).toBeInTheDocument();
  });

  it("re-flowes mailer-wrapped prose into one readable line", () => {
    render(
      <TextBody
        text={
          "We received a sign-in to Example Cloud from a device we do not recognise. If this\n" +
          "was you, confirm it with the link below. The link works once and expires\nin 10 minutes."
        }
      />,
    );
    expect(screen.getByText(/recognise\. If this was you, confirm/)).toBeInTheDocument();
  });

  it("turns a URL the mailer split across lines into one complete link", () => {
    render(
      <TextBody
        text={
          "Confirm using this address, it works once and expires in ten minutes so do not\n" +
          "share it: https://console.cloud.example/verify?token=eyJhbGciOiJSUzI1NiIs%2F\n" +
          "aW50ZW50Lmpzb259&next=%2Fdone"
        }
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://console.cloud.example/verify?token=eyJhbGciOiJSUzI1NiIs%2FaW50ZW50Lmpzb259&next=%2Fdone",
    );
  });

  it("leaves short lines, list items and greetings where the sender put them", () => {
    const { container } = render(
      <TextBody text={"Hi there,\n\n- Reset the password\n- Sign out everywhere\n\nExample Security Team"} />,
    );
    const lines = [...container.querySelectorAll(".text-line")].map((el) => el.textContent?.trim());
    expect(lines).toEqual(["Hi there,", "- Reset the password", "- Sign out everywhere", "Example Security Team"]);
  });
});
