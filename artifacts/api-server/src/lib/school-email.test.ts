import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyLimit, emailProblem, joinNames, schoolDirectory } from "./school-email";
import { schoolLetterEmail } from "./email";

test("the email directory: active teachers, and each parent once with all their children", () => {
  const classes = new Map([[1, "JSS 1"], [2, "Year 3"]]);
  const people = schoolDirectory(
    [{ email: " MUSA@school.test ", name: "Mr Musa", active: true, classIds: [1] }, { email: "gone@school.test", name: "Left", active: false, classIds: [] }],
    [
      { name: "Ada Obi", studentId: "S1", classId: 1, active: true, guardianEmail: "Mum@Home.test", secondGuardianEmail: "dad@home.test" },
      { name: "Chi Obi", studentId: "S2", classId: 2, active: true, guardianEmail: "mum@home.test", secondGuardianEmail: null },
      { name: "Old Boy", studentId: "S3", classId: 1, active: false, guardianEmail: "old@home.test", secondGuardianEmail: null },
      { name: "No Email", studentId: "S4", classId: 1, active: true, guardianEmail: "not an email", secondGuardianEmail: null },
    ],
    classes,
  );
  assert.deepEqual(people.map((p) => [p.kind, p.email, p.name]), [
    ["teacher", "musa@school.test", "Mr Musa"], ["parent", "mum@home.test", "Parent of Ada Obi and Chi Obi"], ["parent", "dad@home.test", "Parent of Ada Obi"],
  ]);
  const mum = people.find((p) => p.email === "mum@home.test")!;
  assert.deepEqual([mum.greeting, mum.detail, mum.classIds], ["Dear Parent of Ada Obi and Chi Obi", "Ada Obi (JSS 1), Chi Obi (Year 3)", [1, 2]]);
  assert.equal(people[0].greeting, "Dear Mr Musa");
});

test("names read naturally, and an email needs a subject, a message, people and room in today's allowance", () => {
  assert.equal(joinNames(["Ada"]), "Ada");
  assert.equal(joinNames(["Ada", "Ben", "Chi"]), "Ada, Ben and Chi");
  assert.equal(emailProblem("Hello", "Body", 3, 0, 500), null);
  assert.equal(emailProblem("", "Body", 3, 0, 500), "Add a subject.");
  assert.equal(emailProblem("Two\nlines", "Body", 3, 0, 500), "The subject must be one line.");
  assert.equal(emailProblem("Hi", " ", 3, 0, 500), "Write a message.");
  assert.equal(emailProblem("Hi", "Body", 0, 0, 500), "Choose at least one teacher or parent.");
  assert.match(emailProblem("Hi", "Body", 50, 480, 500)!, /20 are left today/);
  assert.equal(dailyLimit({}), 500);
  assert.equal(dailyLimit({ SCHOOL_EMAIL_DAILY_LIMIT: "100" }), 100);
  assert.equal(dailyLimit({ SCHOOL_EMAIL_DAILY_LIMIT: "lots" }), 500);
});

test("each letter is addressed to its reader, escapes what they wrote, and signs off as the sender", () => {
  const mail = schoolLetterEmail({ subject: "PTA <meeting>", message: "Line one\nstill one\n\nSecond <b>para</b>", greeting: "Dear Parent of Ada Obi", senderName: "Mrs Okafor", senderTitle: "Head of School", kind: "parent", siteUrl: "https://school.example" });
  assert.match(mail.html, /Dear Parent of Ada Obi,/);
  assert.match(mail.html, /Line one<br>still one/);
  assert.match(mail.html, /Second &lt;b&gt;para&lt;\/b&gt;/);
  assert.match(mail.html, /Mrs Okafor<\/b><br><span[^>]*>Head of School, New World Emerald Private School/);
  assert.match(mail.html, /https:\/\/school.example\/parents/);
  assert.doesNotMatch(mail.html, /<meeting>/);
  assert.match(mail.text, /^Dear Parent of Ada Obi,\n\nLine one/);
  assert.match(schoolLetterEmail({ subject: "S", message: "M", greeting: "Dear Mr Musa", senderName: "D", senderTitle: "Director", kind: "teacher", siteUrl: "https://s" }).html, /https:\/\/s\/portal\/manage/);
});

test("email settings are read however they were pasted into Render", async () => {
  const { emailList } = await import("./approved-identities");
  assert.deepEqual(emailList(" Head@School.com "), ["head@school.com"]);
  assert.deepEqual(emailList('"head@school.com"'), ["head@school.com"]);
  assert.deepEqual(emailList("SCHOOL_HEAD_EMAILS=head@school.com"), ["head@school.com"]);
  assert.deepEqual(emailList("<a@school.com>; 'b@school.com'\nc@school.com"), ["a@school.com", "b@school.com", "c@school.com"]);
  assert.deepEqual(emailList("not an email"), []);
  assert.deepEqual(emailList(undefined), []);
});
