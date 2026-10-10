import { Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import type { DateFormat, MappingRule, ValidationRule } from '../../api/types';

const DATE_FORMATS: DateFormat[] = ['ISO', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'EPOCH_MS'];
const DATA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'date'] as const;

export function MappingEditor({
  mappings,
  onChange,
  sourceFields = [],
}: {
  mappings: MappingRule[];
  onChange: (m: MappingRule[]) => void;
  sourceFields?: string[];
}) {
  const updateMapping = (idx: number, patch: Partial<MappingRule>) => {
    const updated = [...mappings];
    updated[idx] = { ...updated[idx], ...patch };
    onChange(updated);
  };

  const removeMapping = (idx: number) => {
    onChange(mappings.filter((_, i) => i !== idx));
  };

  const addMapping = () => {
    onChange([...mappings, { sourcePath: '', targetPath: '', transforms: [], required: false, nullHandling: 'KEEP' }]);
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Field Mappings</Typography>
        <Button startIcon={<AddIcon />} size="small" variant="outlined" onClick={addMapping}>
          Add Mapping
        </Button>
      </Box>

      {mappings.map((m, idx) => (
        <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <TextField
                size="small"
                label="Source Field"
                value={m.sourcePath ?? ''}
                onChange={(e) => updateMapping(idx, { sourcePath: e.target.value })}
                sx={{ flex: 1 }}
                helperText={sourceFields.length ? `Suggestions: ${sourceFields.slice(0, 5).join(', ')}` : undefined}
              />
              <Typography variant="body2" color="text.secondary">→</Typography>
              <TextField
                size="small"
                label="Destination Field"
                value={m.targetPath}
                onChange={(e) => updateMapping(idx, { targetPath: e.target.value })}
                sx={{ flex: 1 }}
                required
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={m.required}
                    onChange={(e) => updateMapping(idx, { required: e.target.checked })}
                    size="small"
                  />
                }
                label="Required"
              />
              <IconButton size="small" color="error" onClick={() => removeMapping(idx)} disabled={mappings.length <= 1}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                size="small"
                label="Null / Missing Handling"
                value={m.nullHandling ?? 'KEEP'}
                onChange={(e) => updateMapping(idx, { nullHandling: e.target.value as MappingRule['nullHandling'] })}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="KEEP">Keep (pass null/undefined)</MenuItem>
                <MenuItem value="OMIT">Omit property from output</MenuItem>
                <MenuItem value="DEFAULT">Use default value</MenuItem>
                <MenuItem value="ERROR">Fail as error</MenuItem>
              </TextField>

              {m.nullHandling === 'DEFAULT' && (
                <TextField
                  size="small"
                  label="Default Value"
                  value={String(m.defaultValue ?? '')}
                  onChange={(e) => updateMapping(idx, { defaultValue: e.target.value })}
                  sx={{ minWidth: 180 }}
                />
              )}
            </Stack>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

export function ValidationRulesEditor({
  rules,
  onChange,
  fields = [],
}: {
  rules: ValidationRule[];
  onChange: (r: ValidationRule[]) => void;
  fields?: string[];
}) {
  const updateRule = (idx: number, patch: Partial<ValidationRule>) => {
    const updated = [...rules];
    updated[idx] = { ...updated[idx], ...patch };
    onChange(updated);
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  const addRule = () => {
    onChange([...rules, { field: fields[0] ?? '', type: 'string' }]);
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Validation Rules</Typography>
        <Button startIcon={<AddIcon />} size="small" variant="outlined" onClick={addRule}>
          Add Rule
        </Button>
      </Box>

      {rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No custom validation rules added yet.</Typography>
      ) : (
        rules.map((r, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <TextField
                size="small"
                label="Target Field"
                value={r.field}
                onChange={(e) => updateRule(idx, { field: e.target.value })}
                sx={{ minWidth: 160 }}
                required
              />
              <TextField
                select
                size="small"
                label="Type"
                value={r.type ?? 'string'}
                onChange={(e) => updateRule(idx, { type: e.target.value as ValidationRule['type'] })}
                sx={{ minWidth: 130 }}
              >
                {DATA_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(r.required)}
                    onChange={(e) => updateRule(idx, { required: e.target.checked })}
                    size="small"
                  />
                }
                label="Required"
              />
              {r.type === 'string' && (
                <>
                  <TextField
                    size="small"
                    type="number"
                    label="Min Len"
                    value={r.minLength ?? ''}
                    onChange={(e) => updateRule(idx, { minLength: e.target.value ? Number(e.target.value) : undefined })}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Max Len"
                    value={r.maxLength ?? ''}
                    onChange={(e) => updateRule(idx, { maxLength: e.target.value ? Number(e.target.value) : undefined })}
                    sx={{ width: 90 }}
                  />
                </>
              )}
              {(r.type === 'number' || r.type === 'integer') && (
                <>
                  <TextField
                    size="small"
                    type="number"
                    label="Min"
                    value={r.min ?? ''}
                    onChange={(e) => updateRule(idx, { min: e.target.value ? Number(e.target.value) : undefined })}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Max"
                    value={r.max ?? ''}
                    onChange={(e) => updateRule(idx, { max: e.target.value ? Number(e.target.value) : undefined })}
                    sx={{ width: 90 }}
                  />
                </>
              )}
              {r.type === 'date' && (
                <TextField
                  select
                  size="small"
                  label="Format"
                  value={r.dateFormat ?? 'ISO'}
                  onChange={(e) => updateRule(idx, { dateFormat: e.target.value as DateFormat })}
                  sx={{ minWidth: 130 }}
                >
                  {DATE_FORMATS.map((fmt) => (
                    <MenuItem key={fmt} value={fmt}>{fmt}</MenuItem>
                  ))}
                </TextField>
              )}
              <IconButton size="small" color="error" onClick={() => removeRule(idx)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}
