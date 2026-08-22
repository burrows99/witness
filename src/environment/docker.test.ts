import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { Docker } from "./docker.ts";

/** A docker whose CLI output is whatever the test says it is. */
const docker = (output: string | ((args: string[]) => string)): { docker: Docker; calls: string[][] } => {
  const calls: string[][] = [];
  const run = (args: string[]): string => {
    calls.push(args);
    return typeof output === "string" ? output : output(args);
  };
  return { docker: new Docker({ cli: run }), calls };
};

const ports = [
  "acme-api\t0.0.0.0:3002->3000/tcp, [::]:3002->3000/tcp",
  "other-project-search\t0.0.0.0:2112->2112/tcp, 0.0.0.0:8080-8081->8080-8081/tcp, [::]:8080-8081->8080-8081/tcp",
  "loopback-only\t127.0.0.1:5999->5999/tcp",
  "no-ports\t",
].join("\n");

test("publisher finds the container that holds a port", () => {
  equal(docker(ports).docker.publisher(3002), "acme-api");
});

test("publisher understands a port range", () => {
  // `0.0.0.0:8080-8081->8080-8081/tcp` is how docker writes two adjacent ports, and a matcher that only
  // knows the single form reports the port as free while another project is serving on it.
  const { docker: d } = docker(ports);
  equal(d.publisher(8080), "other-project-search");
  equal(d.publisher(8081), "other-project-search");
  equal(d.publisher(8082), undefined);
});

test("publisher counts a loopback binding and ignores the container port", () => {
  const { docker: d } = docker(ports);
  equal(d.publisher(5999), "loopback-only");
  // 3000 is acme-api's port INSIDE the container; nothing is published on the host's 3000 here.
  equal(d.publisher(3000), undefined);
});

test("publisher on an empty daemon answers nobody", () => {
  equal(docker("").docker.publisher(3000), undefined);
  equal(docker("\n").docker.publisher(3000), undefined);
});

test("running lists names and drops the blank line", () => {
  deepEqual(docker("a\nb\n").docker.running(), ["a", "b"]);
  deepEqual(docker("").docker.running(), []);
});

test("isRunning asks about one name", () => {
  const { docker: d } = docker("acme-api\nacme-web\n");
  equal(d.isRunning("acme-api"), true);
  equal(d.isRunning("acme-worker"), false);
});

test("exec passes environment through as -e pairs, and trims the answer", () => {
  const { docker: d, calls } = docker("  value\n");
  equal(d.exec("box", ["printenv", "KEY"], { EXTRA: "1" }), "value");
  deepEqual(calls[0], ["exec", "-e", "EXTRA=1", "box", "printenv", "KEY"]);
});

test("env reads the running container once and remembers it", () => {
  // A key is read many times a run and cannot change mid-run; the cache is why a spec is not shelling
  // out to docker dozens of times.
  const { docker: d, calls } = docker("secret");
  equal(d.env("box", "KEY"), "secret");
  equal(d.env("box", "KEY"), "secret");
  equal(calls.length, 1);
  d.env("box", "OTHER");
  d.env("other-box", "KEY");
  equal(calls.length, 3);
});
