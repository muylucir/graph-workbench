'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Modal from '@cloudscape-design/components/modal';
import Input from '@cloudscape-design/components/input';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Spinner from '@cloudscape-design/components/spinner';
import FormField from '@cloudscape-design/components/form-field';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import Multiselect, { MultiselectProps } from '@cloudscape-design/components/multiselect';

import type { AssemblerState, DerivedDef } from '@/lib/column-assembler';
import {
  TEMPLATES,
  createDraftFromTemplate,
  draftToDerivedMapping,
  draftsFromDeriveds,
  draftsToDeriveds,
  getTemplate,
  tokenColumnCandidates,
  type RuleDraft,
  type SlotSpec,
  type TemplateId,
  type TemplateMeta,
} from '@/lib/derived-templates';

type Props = {
  state: AssemblerState;
  onChange: (deriveds: DerivedDef[]) => void;
  /** Bumped by parent when a preset/snapshot is loaded, so we resync drafts. */
  resyncToken?: number;
};

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; count: number; estimated?: boolean; warnings: string[] }
  | { status: 'error'; message: string };

export default function RuleBuilder({ state, onChange, resyncToken = 0 }: Props) {
  const [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState<number>(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // Resync drafts whenever the parent loads a preset/snapshot.
  useEffect(() => {
    const { drafts: restored, unmatched } = draftsFromDeriveds(state.derived);
    setDrafts(restored);
    setUnmatchedCount(unmatched.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resyncToken]);

  // Push drafts back to parent (debounced). Skip if conversion errors exist.
  useEffect(() => {
    const handle = setTimeout(() => {
      const { deriveds } = draftsToDeriveds(drafts, latestStateRef.current);
      onChange(deriveds);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  function addTemplate(id: TemplateId) {
    setDrafts((prev) => [...prev, createDraftFromTemplate(id)]);
    setPickerOpen(false);
  }

  function updateDraft(id: string, updater: (d: RuleDraft) => RuleDraft) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? updater(d) : d)));
    setPreviews((p) => ({ ...p, [id]: { status: 'idle' } }));
  }

  function deleteDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setPreviews((p) => {
      const { [id]: _, ...rest } = p;
      return rest;
    });
  }

  async function runPreview(draft: RuleDraft) {
    setPreviews((p) => ({ ...p, [draft.id]: { status: 'loading' } }));
    try {
      // Serialize the current AssemblerState to a minimal YAML that
      // collectDerivedPairs can use for its vertexMap lookup.
      const { stateToYaml } = await import('@/lib/column-assembler');
      const yaml = stateToYaml(latestStateRef.current);
      const derivedMapping = draftToDerivedMapping(draft, latestStateRef.current);
      const res = await fetch('/api/derived/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml, derived: derivedMapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPreviews((p) => ({
        ...p,
        [draft.id]: {
          status: 'ok',
          count: data.count,
          estimated: data.estimated,
          warnings: data.warnings ?? [],
        },
      }));
    } catch (e) {
      setPreviews((p) => ({
        ...p,
        [draft.id]: {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  return (
    <SpaceBetween size="s">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box fontSize="body-s" color="text-status-inactive">
          원본 DB에 없는 관계를 만들어 그래프를 풍부하게 해요. MD의 암묵지를 담는 자리.
        </Box>
        <Button iconName="add-plus" onClick={() => setPickerOpen(true)}>
          새 규칙 추가
        </Button>
      </div>

      {unmatchedCount > 0 && (
        <Alert type="info">
          이 매핑에는 Expert 모드에서 작성한 고급 규칙이 <b>{unmatchedCount}개</b> 더 들어있어요.
          여기서는 편집할 수 없고, YAML 탭에서 직접 수정해야 합니다.
        </Alert>
      )}

      {drafts.length === 0 ? (
        <Box textAlign="center" color="text-status-inactive" padding="m">
          아직 규칙이 없어요. 위의 <b>"새 규칙 추가"</b>를 눌러 시작하세요.
        </Box>
      ) : (
        <SpaceBetween size="s">
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              template={getTemplate(d.templateId)}
              state={state}
              preview={previews[d.id] ?? { status: 'idle' }}
              onChange={(u) => updateDraft(d.id, u)}
              onDelete={() => deleteDraft(d.id)}
              onPreview={() => runPreview(d)}
            />
          ))}
        </SpaceBetween>
      )}

      <Modal
        visible={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        size="large"
        header="어떤 관계를 만들까요?"
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 12,
          }}
        >
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => addTemplate(t.id)}
              style={{
                textAlign: 'left',
                padding: 14,
                border: '1px solid #d5dbdb',
                borderRadius: 8,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <Box fontSize="heading-s" fontWeight="bold">
                {t.titleKo}
              </Box>
              <Box fontSize="body-s" padding={{ top: 'xxs' }}>
                {t.subtitleKo}
              </Box>
              <Box fontSize="body-s" color="text-status-inactive" padding={{ top: 'xs' }}>
                예시 · {t.exampleKo}
              </Box>
              <Box fontSize="body-s" color="text-status-info" padding={{ top: 'xxs' }}>
                👉 {t.hintKo}
              </Box>
            </button>
          ))}
        </div>
      </Modal>
    </SpaceBetween>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-draft card                                                     */
/* ------------------------------------------------------------------ */

function DraftCard({
  draft,
  template,
  state,
  preview,
  onChange,
  onDelete,
  onPreview,
}: {
  draft: RuleDraft;
  template: TemplateMeta;
  state: AssemblerState;
  preview: PreviewState;
  onChange: (updater: (d: RuleDraft) => RuleDraft) => void;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const deps = template.dependencies(state);
  const sentence = template.sentenceKo(draft, state);

  return (
    <Container
      header={
        <Header
          variant="h3"
          actions={
            <Button iconName="remove" variant="normal" onClick={onDelete}>
              삭제
            </Button>
          }
        >
          <Badge color="blue">{template.titleKo}</Badge>
        </Header>
      }
    >
      <SpaceBetween size="s">
        <Box>
          <RichSentence markdown={sentence} />
        </Box>

        {deps.length > 0 && (
          <SpaceBetween size="xxs">
            {deps.map((dep, i) => (
              <Alert
                key={i}
                type={dep.severity === 'error' ? 'error' : 'warning'}
                header={dep.severity === 'error' ? '준비가 필요해요' : '참고'}
              >
                {dep.message}
              </Alert>
            ))}
          </SpaceBetween>
        )}

        <SpaceBetween size="xs">
          {template.slots.map((slot) => (
            <SlotEditor
              key={slot.key}
              slot={slot}
              draft={draft}
              state={state}
              onChange={onChange}
            />
          ))}
        </SpaceBetween>

        <FormField
          label="이 관계를 뭐라고 부를까요?"
          description="그래프에 저장되는 관계 이름 (영문·숫자·언더스코어)"
        >
          <Input
            value={draft.edgeTypeName}
            onChange={({ detail }) =>
              onChange((d) => ({ ...d, edgeTypeName: detail.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }))
            }
          />
        </FormField>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={onPreview} disabled={deps.some((x) => x.severity === 'error')}>
            미리보기
          </Button>
          <PreviewBadge preview={preview} />
        </div>
      </SpaceBetween>
    </Container>
  );
}

function PreviewBadge({ preview }: { preview: PreviewState }) {
  if (preview.status === 'idle') {
    return (
      <Box fontSize="body-s" color="text-status-inactive">
        아직 미리보지 않았어요
      </Box>
    );
  }
  if (preview.status === 'loading') {
    return (
      <Box fontSize="body-s" color="text-status-inactive">
        <Spinner /> 계산 중…
      </Box>
    );
  }
  if (preview.status === 'error') {
    return (
      <Box fontSize="body-s" color="text-status-error">
        에러: {preview.message}
      </Box>
    );
  }
  return (
    <Box fontSize="body-s">
      이 규칙은 <b>{preview.estimated ? '약 ' : ''}{preview.count.toLocaleString()}개</b>의 관계를 만들어요
      {preview.warnings.length > 0 && (
        <Box fontSize="body-s" color="text-status-warning" padding={{ top: 'xxs' }}>
          {preview.warnings.join(' · ')}
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Sentence with **bold** highlights                                  */
/* ------------------------------------------------------------------ */

function RichSentence({ markdown }: { markdown: string }) {
  const parts = markdown.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span style={{ fontSize: 14, lineHeight: 1.6 }}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <b key={i} style={{ color: '#0972d3' }}>
              {p.slice(2, -2)}
            </b>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Slot editors                                                       */
/* ------------------------------------------------------------------ */

function SlotEditor({
  slot,
  draft,
  state,
  onChange,
}: {
  slot: SlotSpec;
  draft: RuleDraft;
  state: AssemblerState;
  onChange: (updater: (d: RuleDraft) => RuleDraft) => void;
}) {
  if (slot.kind === 'number') {
    const v = Number(draft.inputs[slot.key] ?? slot.defaultValue);
    return (
      <FormField label={slot.labelKo}>
        <Input
          type="number"
          value={String(v)}
          onChange={({ detail }) =>
            onChange((d) => ({
              ...d,
              inputs: { ...d.inputs, [slot.key]: Number(detail.value) },
            }))
          }
        />
      </FormField>
    );
  }

  if (slot.kind === 'text') {
    const v = String(draft.inputs[slot.key] ?? slot.defaultValue ?? '');
    return (
      <FormField label={slot.labelKo}>
        <Input
          value={v}
          placeholder={slot.placeholder}
          onChange={({ detail }) =>
            onChange((d) => ({
              ...d,
              inputs: { ...d.inputs, [slot.key]: detail.value },
            }))
          }
        />
      </FormField>
    );
  }

  if (slot.kind === 'token_column') {
    const options = tokenColumnCandidates(state, slot.vertexLabel);
    const selected = String(draft.inputs[slot.key] ?? '');
    const selOpt =
      options.find((o) => o.propName === selected) ?? options[0] ?? null;
    return (
      <FormField label={slot.labelKo}>
        {options.length === 0 ? (
          <Box fontSize="body-s" color="text-status-warning">
            선택 가능한 속성이 없어요. {slot.vertexLabel} 노드에 태그·테마 속성을 먼저 넣어주세요.
          </Box>
        ) : (
          <Select
            selectedOption={
              selOpt
                ? { label: selOpt.labelKo, value: selOpt.propName, description: selOpt.propName }
                : null
            }
            options={options.map((o) => ({
              label: o.labelKo,
              value: o.propName,
              description: o.propName,
            }))}
            onChange={({ detail }: { detail: { selectedOption: SelectProps.Option } }) =>
              onChange((d) => ({
                ...d,
                inputs: { ...d.inputs, [slot.key]: detail.selectedOption?.value },
              }))
            }
          />
        )}
      </FormField>
    );
  }

  if (slot.kind === 'pair_list') {
    return (
      <PairListEditor
        labelKo={slot.labelKo}
        vertexLabel={slot.vertexLabel}
        value={
          (draft.inputs[slot.key] as Array<{ a: string; b: string; note?: string }>) ?? []
        }
        onChange={(next) =>
          onChange((d) => ({ ...d, inputs: { ...d.inputs, [slot.key]: next } }))
        }
        state={state}
      />
    );
  }

  if (slot.kind === 'multi_id_picker') {
    return (
      <MultiIdPicker
        labelKo={slot.labelKo}
        vertexLabel={slot.vertexLabel}
        minItems={slot.minItems}
        maxItems={slot.maxItems}
        value={(draft.inputs[slot.key] as string[]) ?? []}
        onChange={(next) =>
          onChange((d) => ({ ...d, inputs: { ...d.inputs, [slot.key]: next } }))
        }
        state={state}
      />
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Pair picker (declared_fact)                                        */
/* ------------------------------------------------------------------ */

function PairListEditor({
  labelKo,
  vertexLabel,
  value,
  onChange,
  state,
}: {
  labelKo: string;
  vertexLabel: string;
  value: Array<{ a: string; b: string; note?: string }>;
  onChange: (next: Array<{ a: string; b: string; note?: string }>) => void;
  state: AssemblerState;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [note, setNote] = useState('');

  const searchCtx = useVertexSearchContext(vertexLabel, state);

  function addPair() {
    if (!a.trim() || !b.trim() || a === b) return;
    onChange([...value, { a: a.trim(), b: b.trim(), note: note.trim() || undefined }]);
    setA('');
    setB('');
    setNote('');
  }

  return (
    <FormField label={labelKo}>
      <SpaceBetween size="xs">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <AutocompleteInput
            placeholder="첫 번째 관광지 검색"
            value={a}
            onChange={setA}
            searchCtx={searchCtx}
          />
          <AutocompleteInput
            placeholder="두 번째 관광지 검색"
            value={b}
            onChange={setB}
            searchCtx={searchCtx}
          />
          <Input
            value={note}
            placeholder="사유 (선택)"
            onChange={({ detail }) => setNote(detail.value)}
          />
          <Button iconName="add-plus" onClick={addPair} disabled={!a || !b || a === b}>
            추가
          </Button>
        </div>

        {value.length === 0 ? (
          <Box fontSize="body-s" color="text-status-inactive">
            아직 선언된 쌍이 없어요.
          </Box>
        ) : (
          <SpaceBetween size="xxs">
            {value.map((p, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: '#f2f3f3',
                  borderRadius: 6,
                }}
              >
                <Box fontSize="body-s">
                  <b>{p.a}</b> ↔ <b>{p.b}</b>
                  {p.note ? ` — ${p.note}` : ''}
                </Box>
                <div style={{ marginLeft: 'auto' }}>
                  <Button
                    iconName="remove"
                    variant="inline-link"
                    onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  >
                    제거
                  </Button>
                </div>
              </div>
            ))}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </FormField>
  );
}

/* ------------------------------------------------------------------ */
/*  Multi id picker (city_cluster)                                     */
/* ------------------------------------------------------------------ */

function MultiIdPicker({
  labelKo,
  vertexLabel,
  minItems,
  maxItems,
  value,
  onChange,
  state,
}: {
  labelKo: string;
  vertexLabel: string;
  minItems?: number;
  maxItems?: number;
  value: string[];
  onChange: (next: string[]) => void;
  state: AssemblerState;
}) {
  const [options, setOptions] = useState<MultiselectProps.Option[]>([]);
  const searchCtx = useVertexSearchContext(vertexLabel, state);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searchCtx) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/sqlite/search?table=${encodeURIComponent(searchCtx.table)}&column=${encodeURIComponent(
        searchCtx.labelColumn,
      )}&idColumn=${encodeURIComponent(searchCtx.idColumn)}&q=` + encodeURIComponent('~'),
      { method: 'GET' },
    )
      .then(() => {
        // Prefill with nothing; the user types to search. We just need the
        // multiselect to be ready to present currently-selected chips properly.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchCtx]);

  // Lightweight lookup: fetch label for each selected id on first render so
  // chips show human names instead of raw codes.
  const [labelById, setLabelById] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!searchCtx) return;
    const missing = value.filter((id) => labelById[id] === undefined);
    if (missing.length === 0) return;
    // Fetch each via a single prefix search per id (cheap for <15 items).
    Promise.all(
      missing.map((id) =>
        fetch(
          `/api/sqlite/search?table=${encodeURIComponent(
            searchCtx.table,
          )}&column=${encodeURIComponent(searchCtx.idColumn)}&idColumn=${encodeURIComponent(
            searchCtx.idColumn,
          )}&q=` + encodeURIComponent(id),
        )
          .then((r) => r.json())
          .then((d) => ({ id, label: d.items?.[0]?.label ?? id })),
      ),
    ).then((results) => {
      const merged = { ...labelById };
      for (const r of results) merged[r.id] = r.label;
      setLabelById(merged);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, searchCtx]);

  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!searchCtx) return;
    if (typed.trim().length < 2) return;
    const t = setTimeout(() => {
      fetch(
        `/api/sqlite/search?table=${encodeURIComponent(searchCtx.table)}&column=${encodeURIComponent(
          searchCtx.labelColumn,
        )}&idColumn=${encodeURIComponent(searchCtx.idColumn)}&q=` + encodeURIComponent(typed),
      )
        .then((r) => r.json())
        .then((d) => {
          setOptions(
            (d.items as Array<{ id: string; label: string }>).map((x) => ({
              value: x.id,
              label: x.label,
              description: x.id,
            })),
          );
        });
    }, 300);
    return () => clearTimeout(t);
  }, [typed, searchCtx]);

  return (
    <FormField
      label={labelKo}
      description={
        maxItems
          ? `${minItems ?? 2}~${maxItems}개 권장 (초과 시 관계 수가 급증)`
          : undefined
      }
    >
      {!searchCtx ? (
        <Box fontSize="body-s" color="text-status-warning">
          {vertexLabel} 노드가 없어 선택할 수 없어요.
        </Box>
      ) : (
        <>
          <Multiselect
            placeholder="이름으로 검색해서 추가"
            selectedOptions={value.map((id) => ({
              value: id,
              label: labelById[id] ?? id,
            }))}
            options={options}
            filteringType="manual"
            onLoadItems={({ detail }) => setTyped(detail.filteringText)}
            onChange={({ detail }) => {
              const next = detail.selectedOptions
                .map((o) => o.value ?? '')
                .filter(Boolean);
              if (maxItems && next.length > maxItems) return; // hard cap
              onChange(next);
            }}
            statusType={loading ? 'loading' : 'finished'}
            empty="2자 이상 입력해서 검색"
            loadingText="검색 중"
            tokenLimit={maxItems}
          />
          {maxItems && value.length > maxItems && (
            <Box fontSize="body-s" color="text-status-error">
              최대 {maxItems}개까지만 선택할 수 있어요.
            </Box>
          )}
        </>
      )}
    </FormField>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-vertex search context                                          */
/*                                                                     */
/*  Resolves table + label column from the current AssemblerState so   */
/*  the search API can look names up without hardcoding table names.   */
/* ------------------------------------------------------------------ */

function useVertexSearchContext(
  vertexLabel: string,
  state: AssemblerState,
): { table: string; idColumn: string; labelColumn: string } | null {
  return useMemo(() => {
    const node = state.nodes.find((n) => n.label === vertexLabel);
    if (!node) return null;
    // Heuristic: prefer a property named like "*NameKo" or "*Name", else fall
    // back to the pk column so the user at least sees the id.
    const nameProp = node.properties.find((p) => /name/i.test(p.name));
    const labelColumn = nameProp?.expr || node.pk;
    return {
      table: node.source.table,
      idColumn: node.pk,
      labelColumn,
    };
  }, [vertexLabel, state]);
}

function AutocompleteInput({
  placeholder,
  value,
  onChange,
  searchCtx,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  searchCtx: ReturnType<typeof useVertexSearchContext>;
}) {
  const [items, setItems] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    if (!searchCtx || value.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(
        `/api/sqlite/search?table=${encodeURIComponent(searchCtx.table)}&column=${encodeURIComponent(
          searchCtx.labelColumn,
        )}&idColumn=${encodeURIComponent(searchCtx.idColumn)}&q=` + encodeURIComponent(value),
      )
        .then((r) => r.json())
        .then((d) => {
          setItems(
            (d.items as Array<{ id: string; label: string }>).map((x) => ({
              value: x.id,
              label: x.label,
            })),
          );
        });
    }, 300);
    return () => clearTimeout(t);
  }, [value, searchCtx]);

  return (
    <Autosuggest
      value={value}
      placeholder={placeholder}
      onChange={({ detail }) => onChange(detail.value)}
      onSelect={({ detail }) => {
        if (detail.selectedOption?.value) onChange(detail.selectedOption.value);
      }}
      options={items}
      empty={value.length < 2 ? '2자 이상 입력' : '결과 없음'}
      enteredTextLabel={(v) => `"${v}" 그대로 사용`}
    />
  );
}
