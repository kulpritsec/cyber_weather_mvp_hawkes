#!/usr/bin/env python3
"""
Cyber Weather — CTI Ingest Bug Fix Script
==========================================
Run on Linode as deploy user:
    cd ~/cyber-weather/app && python3 fix_ingest_bugs.py

Fixes three bugs preventing live CTI ingestion:

BUG 1 — DShield:
  a) Uses /api/portdetails/PORT/ which doesn't exist → /api/port/PORT?json
  b) topips returns a list, code expects dict (.get()) 
  c) SANS ISC blocks requests without User-Agent contact info
  d) content_type=None already applied (good)

BUG 2 — Abuse.ch:
  tags= passes a Python dict to Column(Text) → needs json.dumps()

BUG 3 — GreyNoise:
  tags= may pass dict without serialization → needs json.dumps()
"""

import os
import re
import sys

INGEST_DIR = "backend/app/ingest"

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)
    print(f"  ✓ Written: {path}")

def fix_dshield():
    """Fix DShield ingest module"""
    path = os.path.join(INGEST_DIR, "dshield.py")
    if not os.path.exists(path):
        print(f"  ⚠ {path} not found!")
        return False
    
    content = read_file(path)
    changes = 0
    
    # --- Fix 1a: Wrong API endpoint ---
    # /api/portdetails/PORT/ → /api/port/PORT
    if "portdetails" in content:
        content = content.replace("/api/portdetails/", "/api/port/")
        # Also clean up trailing ? patterns that may have been malformed
        # The correct format is /api/port/22?json  (no trailing slash before ?)
        content = re.sub(r'/api/port/(\d+)/\?json', r'/api/port/\1?json', content)
        print("  ✓ Fixed endpoint: /api/portdetails/ → /api/port/")
        changes += 1
    else:
        # Check if it was already partially fixed but still using wrong format
        if "/api/port/" in content:
            print("  ⊘ Endpoint already uses /api/port/")
        else:
            print("  ⚠ Could not find portdetails or port endpoint reference")
    
    # --- Fix 1b: Add User-Agent header ---
    # SANS ISC requires: "YOU MUST INCLUDE CONTACT INFORMATION IN THE USER-AGENT FIELD"
    if "User-Agent" not in content:
        # Find aiohttp.ClientSession() and add headers
        if "aiohttp.ClientSession()" in content:
            content = content.replace(
                "aiohttp.ClientSession()",
                'aiohttp.ClientSession(headers={"User-Agent": "CyberWeatherMVP/1.0 (admin@kulpritstudios.com)"})'
            )
            print("  ✓ Added User-Agent header to aiohttp session")
            changes += 1
        elif "ClientSession(" in content:
            # Session created with other params — inject headers
            # Find the pattern and add headers kwarg
            pattern = r'(aiohttp\.ClientSession\([^)]*)\)'
            match = re.search(pattern, content)
            if match:
                existing = match.group(1)
                if "headers" not in existing:
                    replacement = existing + ', headers={"User-Agent": "CyberWeatherMVP/1.0 (admin@kulpritstudios.com)"})'
                    content = content[:match.start()] + replacement + content[match.end():]
                    print("  ✓ Injected User-Agent into existing ClientSession")
                    changes += 1
            else:
                print("  ⚠ Could not find ClientSession to add User-Agent — add manually")
    else:
        print("  ⊘ User-Agent already present")
    
    # --- Fix 1c: topips list vs dict ---
    # The API returns a list of dicts like [{"ip": "...", "reports": ..., ...}, ...]
    # Code likely does: data.get('topips') or data.get('records') 
    # Fix: handle both list and dict responses
    
    # Find patterns like: data.get( or result.get( after topips fetch
    # Common pattern: ips = data.get('something', [])
    # Fix: ips = data if isinstance(data, list) else data.get('something', [])
    
    lines = content.split('\n')
    new_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Look for .get( patterns on API response data that could be lists
        # Match patterns like: variable.get('key', []) or variable.get("key")
        # after a json() call
        if '.get(' in line and ('topips' in line.lower() or 
            any(key in line for key in ["'records'", '"records"', "'data'", '"data"', "'topips'", '"topips"'])):
            # Extract the variable name and the get call
            match = re.match(r'(\s*)(\w+)\.get\(([^)]+)\)', line)
            if match:
                indent = match.group(1)
                var_name = match.group(2)
                get_args = match.group(3)
                # Replace with isinstance check
                old_expr = f"{var_name}.get({get_args})"
                new_expr = f"({var_name} if isinstance({var_name}, list) else {var_name}.get({get_args}))"
                line = line.replace(old_expr, new_expr)
                print(f"  ✓ Fixed topips list handling at line {i+1}")
                changes += 1
        new_lines.append(line)
        i += 1
    
    content = '\n'.join(new_lines)
    
    if changes > 0:
        write_file(path, content)
    else:
        print("  ⊘ No DShield changes needed")
    
    return changes > 0


def fix_abusech():
    """Fix Abuse.ch ingest module — tags dict serialization"""
    path = os.path.join(INGEST_DIR, "abusech.py")
    if not os.path.exists(path):
        print(f"  ⚠ {path} not found!")
        return False
    
    content = read_file(path)
    changes = 0
    
    # --- Ensure import json is present ---
    if "import json" not in content:
        # Add after the last import line
        lines = content.split('\n')
        last_import = 0
        for i, line in enumerate(lines):
            if line.startswith('import ') or line.startswith('from '):
                last_import = i
        lines.insert(last_import + 1, 'import json')
        content = '\n'.join(lines)
        print("  ✓ Added 'import json'")
        changes += 1
    
    # --- Fix tags={...} → tags=json.dumps({...}) ---
    # Strategy: find Event( constructor blocks and fix the tags= kwarg
    # The tags value is a multi-line dict like:
    #   tags={
    #       'malware_family': ...,
    #       'c2_server': True,
    #       'feed': 'feodo_tracker'
    #   },
    
    lines = content.split('\n')
    new_lines = []
    i = 0
    in_tags_block = False
    brace_depth = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Detect tags={ that isn't already wrapped in json.dumps
        if re.search(r'\btags\s*=\s*\{', line) and 'json.dumps' not in line:
            # Start of tags dict — wrap with json.dumps(
            line = re.sub(r'(\btags\s*=\s*)\{', r'\1json.dumps({', line)
            in_tags_block = True
            brace_depth = 0
            # Count braces on this line
            for ch in line[line.index('json.dumps('):]:
                if ch == '{':
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0:
                        # Closing brace on same line — add ) after }
                        idx = line.rindex('}')
                        line = line[:idx+1] + ')' + line[idx+1:]
                        in_tags_block = False
                        print(f"  ✓ Fixed tags serialization at line {i+1} (single-line)")
                        changes += 1
                        break
            if in_tags_block:
                print(f"  → tags block starts at line {i+1} (multi-line)")
            new_lines.append(line)
        elif in_tags_block:
            for ch in line:
                if ch == '{':
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0:
                        # Found the closing brace
                        idx = line.rindex('}')
                        line = line[:idx+1] + ')' + line[idx+1:]
                        in_tags_block = False
                        print(f"  ✓ Fixed tags serialization closing at line {i+1}")
                        changes += 1
                        break
            new_lines.append(line)
        else:
            new_lines.append(line)
        i += 1
    
    content = '\n'.join(new_lines)
    
    if changes > 0:
        write_file(path, content)
    else:
        print("  ⊘ No abuse.ch changes needed")
    
    return changes > 0


def fix_greynoise():
    """Fix GreyNoise ingest module — tags serialization"""
    path = os.path.join(INGEST_DIR, "greynoise.py")
    if not os.path.exists(path):
        print(f"  ⚠ {path} not found!")
        return False
    
    content = read_file(path)
    changes = 0
    
    # --- Ensure import json is present ---
    if "import json" not in content:
        lines = content.split('\n')
        last_import = 0
        for i, line in enumerate(lines):
            if line.startswith('import ') or line.startswith('from '):
                last_import = i
        lines.insert(last_import + 1, 'import json')
        content = '\n'.join(lines)
        print("  ✓ Added 'import json'")
        changes += 1
    
    # --- Fix tags=event_tags or tags=variable ---
    # Pattern: tags=some_variable (where variable is a dict)
    # Fix: tags=json.dumps(some_variable) if isinstance(some_variable, dict) else some_variable
    # Simpler: just always json.dumps it
    
    # Find tags= followed by a variable name (not a dict literal, not already wrapped)
    pattern = r'(\btags\s*=\s*)(\w+)(\s*[,\)])'
    matches = list(re.finditer(pattern, content))
    
    for match in reversed(matches):  # reverse to preserve indices
        var_name = match.group(2)
        if var_name == 'json' or 'json.dumps' in match.group(0):
            continue
        replacement = f'{match.group(1)}json.dumps({var_name}) if isinstance({var_name}, dict) else {var_name}{match.group(3)}'
        content = content[:match.start()] + replacement + content[match.end():]
        print(f"  ✓ Fixed tags={var_name} → json.dumps({var_name})")
        changes += 1
    
    # Also handle tags={...} inline dicts (same as abusech)
    if re.search(r'\btags\s*=\s*\{', content) and 'json.dumps({' not in content:
        lines = content.split('\n')
        new_lines = []
        in_tags_block = False
        brace_depth = 0
        
        for idx, line in enumerate(lines):
            if re.search(r'\btags\s*=\s*\{', line) and 'json.dumps' not in line:
                line = re.sub(r'(\btags\s*=\s*)\{', r'\1json.dumps({', line)
                in_tags_block = True
                brace_depth = 0
                for ch in line[line.index('json.dumps('):]:
                    if ch == '{': brace_depth += 1
                    elif ch == '}':
                        brace_depth -= 1
                        if brace_depth == 0:
                            i = line.rindex('}')
                            line = line[:i+1] + ')' + line[i+1:]
                            in_tags_block = False
                            changes += 1
                            break
            elif in_tags_block:
                for ch in line:
                    if ch == '{': brace_depth += 1
                    elif ch == '}':
                        brace_depth -= 1
                        if brace_depth == 0:
                            i = line.rindex('}')
                            line = line[:i+1] + ')' + line[i+1:]
                            in_tags_block = False
                            changes += 1
                            break
            new_lines.append(line)
        content = '\n'.join(new_lines)
    
    # --- Add User-Agent if missing ---
    if "User-Agent" not in content:
        if "aiohttp.ClientSession()" in content:
            content = content.replace(
                "aiohttp.ClientSession()",
                'aiohttp.ClientSession(headers={"User-Agent": "CyberWeatherMVP/1.0 (admin@kulpritstudios.com)"})'
            )
            print("  ✓ Added User-Agent to GreyNoise session")
            changes += 1
    
    if changes > 0:
        write_file(path, content)
    else:
        print("  ⊘ No GreyNoise changes needed")
    
    return changes > 0


def verify_fixes():
    """Verify all fixes were applied correctly"""
    print("\n" + "=" * 50)
    print("  VERIFICATION")
    print("=" * 50)
    
    issues = []
    
    # Check DShield
    dshield = read_file(os.path.join(INGEST_DIR, "dshield.py"))
    if "portdetails" in dshield:
        issues.append("⚠ DShield still references 'portdetails'")
    if "User-Agent" not in dshield:
        issues.append("⚠ DShield missing User-Agent header")
    
    # Check Abuse.ch
    abusech = read_file(os.path.join(INGEST_DIR, "abusech.py"))
    if "import json" not in abusech:
        issues.append("⚠ Abuse.ch missing 'import json'")
    # Check for unserialised tags
    for i, line in enumerate(abusech.split('\n')):
        if re.search(r'\btags\s*=\s*\{', line) and 'json.dumps' not in line:
            issues.append(f"⚠ Abuse.ch line {i+1}: tags dict not wrapped in json.dumps")
    
    # Check GreyNoise
    greynoise = read_file(os.path.join(INGEST_DIR, "greynoise.py"))
    if "import json" not in greynoise:
        issues.append("⚠ GreyNoise missing 'import json'")
    if "timedelta" not in greynoise:
        issues.append("⚠ GreyNoise missing 'timedelta' import")
    
    if issues:
        print("\n  Issues remaining:")
        for issue in issues:
            print(f"    {issue}")
        print("\n  ⚠ Manual review needed for the above items")
    else:
        print("\n  ✓ All automated checks passed")
    
    print("\n" + "=" * 50)
    print("  NEXT STEPS")
    print("=" * 50)
    print("""
  1. Review the changes:
     git diff backend/app/ingest/

  2. Rebuild and restart:
     docker compose build --no-cache backend
     docker compose up -d

  3. Wait for scheduler (15 min) or trigger manually:
     docker compose exec backend python -c "
     from app.services.pipeline import run_ingest_cycle
     import asyncio
     result = asyncio.run(run_ingest_cycle())
     print(result)
     "

  4. Check for live events:
     docker compose exec db psql -U cyberweather cyber_weather -c \\
       "SELECT source, COUNT(*) FROM events WHERE source != 'synthetic' GROUP BY source;"

  5. Watch logs:
     docker compose logs backend --tail 50 -f
""")


if __name__ == "__main__":
    print("=" * 50)
    print("  Cyber Weather — CTI Ingest Bug Fix")
    print("=" * 50)
    
    if not os.path.exists(INGEST_DIR):
        print(f"\n  ⚠ Directory {INGEST_DIR} not found!")
        print(f"  Run this from ~/cyber-weather/app/")
        sys.exit(1)
    
    print(f"\n  Working directory: {os.getcwd()}")
    print(f"  Ingest dir: {INGEST_DIR}")
    
    print("\n--- DShield Fixes ---")
    fix_dshield()
    
    print("\n--- Abuse.ch Fixes ---")
    fix_abusech()
    
    print("\n--- GreyNoise Fixes ---")
    fix_greynoise()
    
    verify_fixes()
