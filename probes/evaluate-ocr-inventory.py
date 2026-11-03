"""Evaluate OCR output against separate saved screenshot audit; no task vocabulary."""
import json,re,unicodedata,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
d=root/'evidence/apple-vision-ocr'
raw=json.loads((d/'raw.json').read_text())
truth=json.loads((root/'evidence/appium-inventory-2026-10-31T23-34-47-389Z/visual-truth.json').read_text())
def norm(s): return unicodedata.normalize('NFKC',s)
expected={}
for p in truth['pages']:
 for name,done,total in p['tasks']:
  key=norm(name)
  assert key not in expected or expected[key]==(done,total)
  expected[key]=(done,total)
actual={};observations=[];conflicts=[];perpage=[]
for page in raw['pages']:
 rows=[]
 for line in page['lines']:
  m=re.fullmatch(r'(.*?)\s*\((\d+)/(\d+)\)',norm(line['text']))
  if not m:continue
  name=m.group(1).strip();quota=(int(m[2]),int(m[3]))
  if name in actual and actual[name]!=quota:conflicts.append(name)
  actual[name]=quota
  row={'name':name,'done':quota[0],'total':quota[1],'rawText':line['text'],'bounds':line['bounds'],'file':page['file'],'confidence':line['confidence']}
  rows.append(row);observations.append(row)
 perpage.append({'file':page['file'],'titleRows':len(rows),'recognitionMs':page['recognitionMs']})
missing=sorted(set(expected)-set(actual));extra=sorted(set(actual)-set(expected))
wrong=[{'name':n,'expected':expected[n],'actual':actual[n]} for n in expected.keys()&actual.keys() if expected[n]!=actual[n]]
correct=sum(actual.get(n)==q for n,q in expected.items())
report={'engine':raw['engine'],'normalization':'Unicode NFKC for fullwidth/halfwidth parentheses and punctuation; no spelling correction, task dictionary or fuzzy matching','perPage':perpage,'expectedUnique':len(expected),'recognizedTitleObservations':len(observations),'recognizedUnique':len(actual),'overlapRowsMerged':len(observations)-len(actual),'correctNameQuota':correct,'coveragePercent':100*correct/len(expected),'missing':missing,'extra':extra,'wrongQuotas':wrong,'conflicts':conflicts,'passedTitleQuotaInventory':not missing and not extra and not wrong and not conflicts,'boundaries':{'top':any('完成进度 0/20' in l['text'] for l in raw['pages'][0]['lines']),'bottom':any('以上奖励均为最高奖励' in l['text'] for l in raw['pages'][-1]['lines'])},'limits':['Only 3 saved screenshots in one inventory; no live collection tested','Requirements contain OCR errors; no full reward or button-binding acceptance','Bounds are OCR text boxes, not independently measured click boxes','Cold first recognition includes initialization; no network request instrumentation, no LLM API calls by probe']}
(d/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
(d/'recognized-tasks.json').write_text(json.dumps(observations,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
