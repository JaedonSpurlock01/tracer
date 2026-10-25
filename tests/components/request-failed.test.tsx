/**
 * -------------------------------------------------------------------------
 * @file   request-failed.test.tsx
 * @brief  Tests the page shown when a request fails on the server.
 *
 * @description
 *  Covers the two states of the failure page: a database that did not
 *  answer, named by its digest, and any other server error, each with a
 *  Retry action that re-renders the page.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import RequestFailed from "@/components/tracer/request-failed";
import { databaseUnavailableDigest } from "@/data/database-unavailable";

afterEach(cleanup);

it("says the database did not answer and retries the page", () => {
  const retry = vi.fn();
  render(<RequestFailed error={Object.assign(new Error("An error occurred in the Server Components render."), { digest: databaseUnavailableDigest })} retry={retry} />);

  expect(screen.getByRole("heading", { name: "The database did not answer" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/waited 10 seconds/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("keeps other server errors generic", () => {
  render(<RequestFailed error={Object.assign(new Error("boom"), { digest: "1234" })} retry={() => undefined} />);

  expect(screen.getByRole("heading", { name: "This page could not load" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).not.toHaveTextContent(/boom|database/i);
});
