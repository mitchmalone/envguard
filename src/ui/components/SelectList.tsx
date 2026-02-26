import { Box, Text, useInput } from 'ink';

export interface SelectItem {
  label: string;
  value: string;
  hint?: string;
  selected: boolean;
  disabled?: boolean;
}

interface SelectListProps {
  items: SelectItem[];
  cursor: number;
  onToggle: (index: number) => void;
  onToggleAll: () => void;
  onCursorChange: (index: number) => void;
  onSubmit: () => void;
  onBack?: () => void;
  title?: string;
}

export function SelectList({
  items,
  cursor,
  onToggle,
  onToggleAll,
  onCursorChange,
  onSubmit,
  onBack,
  title,
}: SelectListProps) {
  useInput((input, key) => {
    if (key.upArrow) {
      onCursorChange(cursor > 0 ? cursor - 1 : items.length - 1);
    } else if (key.downArrow) {
      onCursorChange(cursor < items.length - 1 ? cursor + 1 : 0);
    } else if (input === ' ') {
      if (!items[cursor]?.disabled) {
        onToggle(cursor);
      }
    } else if (key.return) {
      onSubmit();
    } else if (key.escape && onBack) {
      onBack();
    } else if (input === 'a') {
      onToggleAll();
    }
  });

  return (
    <Box flexDirection="column">
      {title ? (
        <Text>
          {`${title} `}
          <Text dimColor>(space to toggle, a for all, enter to continue)</Text>
        </Text>
      ) : null}
      {items.map((item, i) => {
        const pointer = i === cursor ? '❯ ' : '  ';
        const check = item.selected ? '✓' : '○';
        return (
          <Text key={item.value}>
            {item.disabled ? (
              <Text
                dimColor
              >{`${pointer}  ${item.label}${item.hint ? ` (${item.hint})` : ''}`}</Text>
            ) : (
              <Text>
                {`${pointer}`}
                <Text color={item.selected ? 'green' : undefined}>{check}</Text>
                {` ${item.label}`}
                {item.hint ? <Text dimColor>{` (${item.hint})`}</Text> : null}
              </Text>
            )}
          </Text>
        );
      })}
    </Box>
  );
}
