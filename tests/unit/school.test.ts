import { describe, expect, it } from 'vitest';
import { looksLikeSchoolEmail } from '../../src/lib/school.ts';

describe('looksLikeSchoolEmail', () => {
  it('knows school emails the way the server does', () => {
    for (const email of ['ada@harvard.edu', 'ada@mail.mit.edu', 'ada@unilag.edu.ng', 'ada@student.unimelb.edu.au', 'ada@strath.ac.uk', 'ada@student.uj.ac.za', ' Ada@UG.EDU.GH ']) {
      expect(looksLikeSchoolEmail(email), email).toBe(true);
    }
  });

  it('says nothing for anything else', () => {
    for (const email of ['ada@gmail.com', 'ada@edu.com', 'ada@education.org', 'ada@harvard.edu.fake.com', 'ada@edu', 'ada@', '@harvard.edu', 'ada@harvard..edu', '', 'ada']) {
      expect(looksLikeSchoolEmail(email), email).toBe(false);
    }
  });
});
