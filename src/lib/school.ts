/** Whether [email] is plainly a school's: .edu, or .edu or .ac under a country (.edu.ng, .ac.uk),
 * as the server reads them. The server has the final say, and also knows universities on their
 * own domains (like utoronto.ca), so this only ever says yes for sure, never no. */
export function looksLikeSchoolEmail(email: string): boolean {
  const [name, domain = ''] = email.trim().toLowerCase().split('@');
  if (!name || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
  return /\.edu$/.test(domain) || /\.(edu|ac)\.[a-z]{2}$/.test(domain);
}
