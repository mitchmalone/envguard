import { Text } from 'ink';

interface BannerProps {
  subtitle?: string;
}

export function Banner({ subtitle }: BannerProps) {
  return (
    <Text>
      <Text bold>envguard</Text>
      {subtitle ? <Text dimColor>{` · ${subtitle}`}</Text> : null}
    </Text>
  );
}
