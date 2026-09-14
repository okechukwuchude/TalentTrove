import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

export type TailoredResumeProps = {
  contact: { name: string; email: string; phone?: string; location?: string; links?: string[] };
  sectionOrder: string[];
  summary: string;
  skills: string[];
  experience: Array<{ title: string; company: string; dates: string; bullets: string[] }>;
  education: Array<{ degree: string; school: string; dates: string }>;
};

const KNOWN_SECTIONS = ['summary', 'skills', 'experience', 'education'] as const;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica', color: '#1a1a1a' },
  name: { fontSize: 18, fontWeight: 'bold', marginBottom: 2 },
  contactLine: { fontSize: 10, color: '#444444', marginBottom: 12 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 2,
  },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bullet: { width: 10 },
  bulletText: { flex: 1 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  entryTitle: { fontSize: 11, fontWeight: 'bold' },
  entryDates: { fontSize: 10, color: '#444444' },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap' },
  skillChip: { fontSize: 10, marginRight: 6, marginBottom: 4 },
});

function isSectionNonEmpty(key: string, props: TailoredResumeProps): boolean {
  switch (key) {
    case 'summary':
      return props.summary.trim().length > 0;
    case 'skills':
      return props.skills.length > 0;
    case 'experience':
      return props.experience.length > 0;
    case 'education':
      return props.education.length > 0;
    default:
      return false;
  }
}

export function TailoredResumeDocument(props: TailoredResumeProps) {
  const orderedSections = props.sectionOrder.filter(
    (key) => (KNOWN_SECTIONS as readonly string[]).includes(key) && isSectionNonEmpty(key, props),
  );
  const contactLine = [props.contact.email, props.contact.phone, props.contact.location, ...(props.contact.links ?? [])]
    .filter((value): value is string => Boolean(value))
    .join('   •   ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{props.contact.name}</Text>
        <Text style={styles.contactLine}>{contactLine}</Text>

        {orderedSections.map((key) => (
          <View key={key}>
            {key === 'summary' && (
              <View>
                <Text style={styles.sectionTitle}>Summary</Text>
                <Text style={styles.paragraph}>{props.summary}</Text>
              </View>
            )}
            {key === 'skills' && (
              <View>
                <Text style={styles.sectionTitle}>Skills</Text>
                <View style={styles.skillsRow}>
                  {props.skills.map((skill, index) => (
                    <Text key={`${skill}-${index}`} style={styles.skillChip}>
                      {skill}
                      {index < props.skills.length - 1 ? ',' : ''}
                    </Text>
                  ))}
                </View>
              </View>
            )}
            {key === 'experience' && (
              <View>
                <Text style={styles.sectionTitle}>Experience</Text>
                {props.experience.map((entry, index) => (
                  <View key={index} wrap={false}>
                    <View style={styles.entryHeader}>
                      <Text style={styles.entryTitle}>
                        {entry.title} — {entry.company}
                      </Text>
                      <Text style={styles.entryDates}>{entry.dates}</Text>
                    </View>
                    {entry.bullets.map((bullet, bulletIndex) => (
                      <View key={bulletIndex} style={styles.bulletRow}>
                        <Text style={styles.bullet}>{'•'}</Text>
                        <Text style={styles.bulletText}>{bullet}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
            {key === 'education' && (
              <View>
                <Text style={styles.sectionTitle}>Education</Text>
                {props.education.map((entry, index) => (
                  <View key={index} style={styles.entryHeader}>
                    <Text style={styles.entryTitle}>
                      {entry.degree} — {entry.school}
                    </Text>
                    <Text style={styles.entryDates}>{entry.dates}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </Page>
    </Document>
  );
}
