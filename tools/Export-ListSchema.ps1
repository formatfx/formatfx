<#
.SYNOPSIS
  Exports a SharePoint list's column schema (and optionally sample rows) as
  JSON for the List Formatting Sandbox ("Import schema..." in the Data tab).

.DESCRIPTION
  Works with both PnP.PowerShell (modern) and the legacy
  SharePointPnPPowerShellOnline module. Captures internal name, display name,
  SP field type, lookup target list/column, read-only (protected) flags and
  choice options. With -SampleRows N it also pulls the first N list items so
  the sandbox previews against your real data.

.EXAMPLE
  Connect-PnPOnline -Url https://contoso.sharepoint.com/sites/team -Interactive
  ./Export-ListSchema.ps1 -ListName "Tasks" -SampleRows 3 -OutFile tasks.listschema.json

.EXAMPLE
  # Legacy module + web login, connect handled by the script:
  ./Export-ListSchema.ps1 -SiteUrl https://contoso.sharepoint.com/sites/team -ListName "Tasks" -UseWebLogin
#>
param(
    [Parameter(Mandatory = $true)][string]$ListName,
    [string]$SiteUrl,
    [int]$SampleRows = 0,
    [string]$OutFile,
    [switch]$UseWebLogin,
    # include hidden/system fields too (default: visible fields only)
    [switch]$IncludeHidden
)

$ErrorActionPreference = 'Stop'

if ($SiteUrl) {
    if ($UseWebLogin) {
        Connect-PnPOnline -Url $SiteUrl -UseWebLogin
    }
    else {
        Connect-PnPOnline -Url $SiteUrl -Interactive
    }
}

$spFields = Get-PnPField -List $ListName

# Fields that are read-only-in-practice even when ReadOnlyField is false
$protectedNames = @('ID', 'Created', 'Modified', 'Author', 'Editor', 'ContentType', 'Attachments', '_UIVersionString')

$fields = @()
foreach ($f in $spFields) {
    if (-not $IncludeHidden) {
        if ($f.Hidden) { continue }
        # skip noisy internals but keep the useful system columns
        if ($f.InternalName -like '_*' -and $f.InternalName -ne '_UIVersionString') { continue }
        if ($f.TypeAsString -eq 'Computed' -and $f.InternalName -ne 'LinkTitle') { continue }
    }

    $entry = [ordered]@{
        internalName = $f.InternalName
        displayName  = $f.Title
        type         = $f.TypeAsString
    }

    if ($f.ReadOnlyField -or ($protectedNames -contains $f.InternalName)) {
        $entry.readOnly = $true
    }

    if ($f.TypeAsString -in @('Lookup', 'LookupMulti')) {
        $lookupListTitle = $null
        if ($f.LookupList) {
            try {
                $targetList = Get-PnPList -Identity ([guid]$f.LookupList)
                $lookupListTitle = $targetList.Title
            }
            catch { $lookupListTitle = $f.LookupList }
        }
        $entry.lookupList = $lookupListTitle
        $entry.lookupColumn = $f.LookupField
    }

    if ($f.TypeAsString -in @('Choice', 'MultiChoice')) {
        $choiceField = $f
        try { $choiceField = Get-PnPField -List $ListName -Identity $f.InternalName } catch {}
        if ($choiceField.Choices) { $entry.choices = @($choiceField.Choices) }
    }

    $fields += [pscustomobject]$entry
}

$result = [ordered]@{
    list   = $ListName
    fields = $fields
}

if ($SampleRows -gt 0) {
    $items = Get-PnPListItem -List $ListName -PageSize $SampleRows | Select-Object -First $SampleRows
    $rows = @()
    foreach ($item in $items) {
        $row = [ordered]@{}
        foreach ($f in $fields) {
            $value = $item[$f.internalName]
            if ($null -eq $value) { $row[$f.internalName] = $null; continue }

            switch -Regex ($f.type) {
                '^(User|UserMulti)$' {
                    $people = @()
                    foreach ($u in @($value)) {
                        $people += [ordered]@{ title = $u.LookupValue; email = $u.Email }
                    }
                    if ($f.type -eq 'User') { $row[$f.internalName] = $people[0] }
                    else { $row[$f.internalName] = $people }
                }
                '^(Lookup|LookupMulti)$' {
                    $lookups = @()
                    foreach ($l in @($value)) {
                        $lookups += [ordered]@{ lookupId = $l.LookupId; lookupValue = $l.LookupValue }
                    }
                    if ($f.type -eq 'Lookup') { $row[$f.internalName] = $lookups[0] }
                    else { $row[$f.internalName] = $lookups }
                }
                '^DateTime$' {
                    $row[$f.internalName] = ([datetime]$value).ToString('yyyy-MM-ddTHH:mm:ssZ')
                }
                '^URL$' {
                    $row[$f.internalName] = [string]$value.Url
                }
                default {
                    $row[$f.internalName] = $value
                }
            }
        }
        $rows += [pscustomobject]$row
    }
    $result.sampleRows = $rows
}

$json = [pscustomobject]$result | ConvertTo-Json -Depth 8

if ($OutFile) {
    $json | Out-File -FilePath $OutFile -Encoding utf8
    Write-Host "Schema written to $OutFile - paste its contents into the sandbox via Data > Import schema..."
}
else {
    $json
}
