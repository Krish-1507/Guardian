import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGoTestOutput,
  parseCargoTestOutput,
  parseFlutterMachineOutput,
  parseDotnetSummary,
  parseMavenSummary,
  parseGradleXml,
} from "../src/analyzers/suiteRunner.js";

test("go test -json: counts pass/fail/skip and skips package-level events", () => {
  const out = [
    '{"Action":"pass","Package":"example/math","Test":"TestAdd","Elapsed":0.01}',
    '{"Action":"fail","Package":"example/math","Test":"TestSub","Elapsed":0.02}',
    '{"Action":"skip","Package":"example/math","Test":"TestSkipMe","Elapsed":0}',
    '{"Action":"pass","Package":"example/math"}',
    '{"Action":"output","Package":"example/math","Output":"=== RUN TestAdd\\n"}',
  ].join("\n");
  const { tests, passed, failed } = parseGoTestOutput(out);
  assert.equal(passed, 2);
  assert.equal(failed, 1);
  assert.equal(tests.length, 3);
  assert.equal(tests[1].status, "failed");
  assert.equal(tests[1].name, "TestSub");
});

test("cargo test --format json: counts ok/failed/ignored test events", () => {
  const out = [
    '{"type":"suite","event":"started","name":"math","test_count":3}',
    '{"type":"test","name":"math::adds","event":"ok","exec_time":0.001}',
    '{"type":"test","name":"math::fails","event":"failed","exec_time":0.002}',
    '{"type":"test","name":"math::ignored_one","event":"ignored"}',
    '{"type":"suite","event":"ok","passed":2,"failed":1,"ignored":1,"measured":0}',
  ].join("\n");
  const { tests, passed, failed } = parseCargoTestOutput(out);
  assert.equal(passed, 2);
  assert.equal(failed, 1);
  assert.equal(tests.length, 3);
  assert.equal(tests[2].status, "passed");
});

test("flutter test --machine: maps testStart names to testDone results", () => {
  const out = [
    '{"type":"testStart","time":0,"testID":1,"name":"counter increments","suiteID":0}',
    '{"type":"testStart","time":1,"testID":2,"name":"counter decrements","suiteID":0}',
    '{"type":"testDone","time":50,"testID":1,"result":"success"}',
    '{"type":"testDone","time":60,"testID":2,"result":"failure"}',
    '{"type":"done","time":70,"success":false}',
  ].join("\n");
  const { tests, passed, failed } = parseFlutterMachineOutput(out);
  assert.equal(passed, 1);
  assert.equal(failed, 1);
  assert.equal(tests[0].name, "counter increments");
  assert.equal(tests[1].name, "counter decrements");
});

test("dotnet test: parses the summary line (with ANSI codes stripped)", () => {
  const out =
    "\x1b[32m  Passed!\x1b[0m  - Failed: 0, Passed: 3, Skipped: 1, Total: 4, Duration: 1.2s";
  const parsed = parseDotnetSummary(out);
  assert.deepEqual(parsed, { passed: 3, failed: 0, total: 4 });
  assert.equal(parseDotnetSummary("nothing useful here"), null);
});

test("maven: sums surefire 'Tests run' lines across classes", () => {
  const out = [
    "[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.5 s - in com.example.AppTest",
    "[INFO] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.3 s - in com.example.UtilTest",
  ].join("\n");
  assert.deepEqual(parseMavenSummary(out), { passed: 4, failed: 1, total: 5 });
});

test("gradle: sums testsuite attributes regardless of attribute order", () => {
  const xml =
    '<?xml version="1.0"?><testsuites>' +
    '<testsuite name="AppTest" tests="3" skipped="0" failures="1" errors="0">' +
    '<testcase name="a" classname="AppTest"/></testsuite>' +
    '<testsuite name="UtilTest" errors="1" tests="2" failures="0" skipped="0">' +
    "<testcase name=\"b\" classname=\"UtilTest\"/></testsuite></testsuites>";
  assert.deepEqual(parseGradleXml(xml), { passed: 3, failed: 2, total: 5 });
});
