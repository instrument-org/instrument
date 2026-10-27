/**
 * The fixed AppleScript the Mail, Notes and Messages apps run, one per tool,
 * shipped with the app. Whatever a call supplies reaches a script only as an
 * `on run argv` value, never as script text.
 */

/**
 * Handlers every script shares, ahead of its own `on run`: the separators,
 * a date as local `YYYY-MM-DDTHH:MM:SS`, text from a value that may be
 * missing, a list joined, and a list that `argv` carries as its length
 * followed by its items.
 */
const SCRIPT_HELPERS = `property US : character id 31
property RS : character id 30

on two(n)
	return text -2 thru -1 of ("0" & n)
end two

on iso(d)
	if d is missing value then return ""
	return (year of d as text) & "-" & my two((month of d) as integer) & "-" & my two(day of d) & "T" & my two(hours of d) & ":" & my two(minutes of d) & ":" & my two(seconds of d)
end iso

on str(x)
	if x is missing value then return ""
	return x as text
end str

on joined(xs, sep)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to sep
	set out to xs as text
	set AppleScript's text item delimiters to saved
	return out
end joined

on takeList(argv, i)
	set n to (item i of argv) as integer
	set xs to {}
	repeat with k from 1 to n
		set end of xs to item (i + k) of argv
	end repeat
	return {xs, i + n + 1}
end takeList
`;

/** Finding an account, a mailbox and a message, which most of Mail's scripts do. */
const MAIL_HELPERS = `${SCRIPT_HELPERS}
on accountNamed(theName)
	tell application id "com.apple.mail"
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			if name of (item i of theAccounts) is theName then return item i of theAccounts
		end repeat
	end tell
	error number 9001
end accountNamed

on mailboxNamed(theAccount, theName)
	tell application id "com.apple.mail"
		set theNames to name of every mailbox of theAccount
		repeat with i from 1 to count of theNames
			if item i of theNames is theName then return mailbox i of theAccount
		end repeat
	end tell
	error number 9002
end mailboxNamed

on searchedBoxes(accountName, boxName)
	tell application id "com.apple.mail"
		if boxName is not "" then return {my mailboxNamed(my accountNamed(accountName), boxName)}
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account whose enabled is true
		end if
		set theBoxes to {}
		repeat with i from 1 to count of theAccounts
			set theBoxes to theBoxes & (every mailbox of (item i of theAccounts))
		end repeat
		return theBoxes
	end tell
end searchedBoxes

on person(theName, theAddress)
	if theName is missing value or theName is "" then return my str(theAddress)
	return theName & " <" & my str(theAddress) & ">"
end person

on messageLine(theMessage)
	tell application id "com.apple.mail"
		set theBox to mailbox of theMessage
		try
			set accountName to name of account of theBox
		on error
			set accountName to ""
		end try
		return ((id of theMessage) as text) & US & accountName & US & my str(name of theBox) & US & my iso(date received of theMessage) & US & my str(sender of theMessage) & US & my str(subject of theMessage) & US & ((read status of theMessage) as text)
	end tell
end messageLine

on findMessage(theId, accountName, boxName)
	set theBoxes to my searchedBoxes(accountName, boxName)
	tell application id "com.apple.mail"
		-- Mail's own inbox holds every account's, so it is searched only when
		-- the call named no account: with one named, searching it would find
		-- and act on another account's message while the refusal, and the
		-- mailbox a move files into, both say the named one.
		if boxName is "" and accountName is "" then set theBoxes to {inbox} & theBoxes
		repeat with i from 1 to count of theBoxes
			try
				set found to (messages of (item i of theBoxes) whose id is theId)
				if (count of found) > 0 then return item 1 of found
			end try
		end repeat
	end tell
	error number 9003
end findMessage
`;

/** Mail's scripts, by what each does. */
export const MAIL_SCRIPTS = {
  accounts: `${SCRIPT_HELPERS}
on run argv
	set out to {}
	tell application id "com.apple.mail"
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			set theAccount to item i of theAccounts
			set end of out to (name of theAccount) & US & my joined(email addresses of theAccount, ",") & US & ((enabled of theAccount) as text)
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
  compose: `${SCRIPT_HELPERS}
on run argv
	set sendNow to (item 1 of argv) is "send"
	set theSubject to item 2 of argv
	set theBody to item 3 of argv
	set theSender to item 4 of argv
	set {toList, i} to my takeList(argv, 5)
	set {ccList, i} to my takeList(argv, i)
	set {bccList, i} to my takeList(argv, i)
	set {pathList, i} to my takeList(argv, i)
	set fileList to {}
	repeat with thePath in pathList
		set end of fileList to POSIX file (contents of thePath)
	end repeat
	tell application id "com.apple.mail"
		if (count of (every account whose enabled is true)) is 0 then error number 9004
		set theMessage to make new outgoing message with properties {subject:theSubject, content:theBody, visible:(not sendNow)}
		if theSender is not "" then set sender of theMessage to theSender
		tell theMessage
			repeat with theAddress in toList
				make new to recipient at end of to recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theAddress in ccList
				make new cc recipient at end of cc recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theAddress in bccList
				make new bcc recipient at end of bcc recipients with properties {address:(contents of theAddress)}
			end repeat
			repeat with theFile in fileList
				tell content to make new attachment with properties {file name:(contents of theFile)} at after last paragraph
			end repeat
		end tell
		if sendNow then
			if (count of fileList) > 0 then delay 1
			send theMessage
		end if
	end tell
	return ""
end run
`,
  list: `${MAIL_HELPERS}
on run argv
	set accountName to item 1 of argv
	set boxName to item 2 of argv
	set unreadOnly to (item 3 of argv) is "1"
	set theLimit to (item 4 of argv) as integer
	tell application id "com.apple.mail"
		if boxName is not "" then
			set theBox to my mailboxNamed(my accountNamed(accountName), boxName)
		else if accountName is not "" then
			set theBox to my mailboxNamed(my accountNamed(accountName), "INBOX")
		else
			set theBox to inbox
		end if
		if unreadOnly then
			set found to (messages of theBox whose read status is false)
		else
			set n to count of messages of theBox
			if n > theLimit then set n to theLimit
			if n is 0 then return ""
			set found to messages 1 thru n of theBox
		end if
	end tell
	set out to {}
	repeat with i from 1 to count of found
		if i > theLimit then exit repeat
		set end of out to my messageLine(item i of found)
	end repeat
	return my joined(out, RS)
end run
`,
  mailboxes: `${MAIL_HELPERS}
on run argv
	set accountName to item 1 of argv
	set out to {}
	tell application id "com.apple.mail"
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account whose enabled is true
		end if
		repeat with i from 1 to count of theAccounts
			set theAccount to item i of theAccounts
			set theName to name of theAccount
			set theNames to name of every mailbox of theAccount
			set theCounts to unread count of every mailbox of theAccount
			repeat with k from 1 to count of theNames
				set end of out to theName & US & (item k of theNames) & US & ((item k of theCounts) as text)
			end repeat
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
  move: `${MAIL_HELPERS}
on run argv
	set theMessage to my findMessage((item 1 of argv) as integer, item 2 of argv, item 3 of argv)
	tell application id "com.apple.mail"
		set theAccount to account of mailbox of theMessage
		try
			set theBox to my mailboxNamed(theAccount, item 4 of argv)
		on error number 9002
			error number 9005
		end try
		move theMessage to theBox
		return (name of theAccount) & US & (name of theBox)
	end tell
end run
`,
  read: `${MAIL_HELPERS}
on run argv
	set theMessage to my findMessage((item 1 of argv) as integer, item 2 of argv, item 3 of argv)
	tell application id "com.apple.mail"
		set toList to {}
		repeat with theRecipient in (to recipients of theMessage)
			set end of toList to my person(name of theRecipient, address of theRecipient)
		end repeat
		set ccList to {}
		repeat with theRecipient in (cc recipients of theMessage)
			set end of ccList to my person(name of theRecipient, address of theRecipient)
		end repeat
		set attachmentNames to name of every mail attachment of theMessage
		set theText to my str(content of theMessage)
	end tell
	return my messageLine(theMessage) & US & my joined(toList, ", ") & US & my joined(ccList, ", ") & US & my joined(attachmentNames, ", ") & US & theText
end run
`,
  search: `${MAIL_HELPERS}
on run argv
	set theQuery to item 1 of argv
	set theLimit to (item 4 of argv) as integer
	set theBoxes to my searchedBoxes(item 2 of argv, item 3 of argv)
	set out to {}
	tell application id "com.apple.mail"
		repeat with i from 1 to count of theBoxes
			try
				set found to (messages of (item i of theBoxes) whose subject contains theQuery or sender contains theQuery)
			on error
				set found to {}
			end try
			repeat with k from 1 to count of found
				if k > theLimit then exit repeat
				set end of out to my messageLine(item k of found)
			end repeat
		end repeat
	end tell
	return my joined(out, RS)
end run
`,
} as const;

/** Finding an account and a folder, and naming a folder by its path. */
const NOTES_HELPERS = `${SCRIPT_HELPERS}
on accountNamed(theName)
	tell application id "com.apple.Notes"
		if theName is "" then return default account
		set theAccounts to every account
		repeat with i from 1 to count of theAccounts
			if name of (item i of theAccounts) is theName then return item i of theAccounts
		end repeat
	end tell
	error number 9011
end accountNamed

on folderPath(theFolder)
	tell application id "com.apple.Notes"
		set thePath to name of theFolder
		set theContainer to container of theFolder
		repeat while class of theContainer is folder
			set thePath to (name of theContainer) & "/" & thePath
			set theContainer to container of theContainer
		end repeat
	end tell
	return thePath
end folderPath

on allFolders(theAccount)
	set seen to {}
	set out to {}
	tell application id "com.apple.Notes"
		set queue to every folder of theAccount
		repeat while (count of queue) > 0
			set theFolder to item 1 of queue
			set queue to rest of queue
			set theId to id of theFolder
			if seen does not contain theId then
				set end of seen to theId
				set end of out to theFolder
				set queue to queue & (every folder of theFolder)
			end if
		end repeat
	end tell
	return out
end allFolders

on folderAt(theAccount, thePath)
	set theFolders to my allFolders(theAccount)
	repeat with i from 1 to count of theFolders
		if my folderPath(item i of theFolders) is thePath then return item i of theFolders
	end repeat
	error number 9012
end folderAt

on searchedFolders(accountName, thePath)
	tell application id "com.apple.Notes"
		if thePath is not "" then return {my folderAt(my accountNamed(accountName), thePath)}
		if accountName is not "" then
			set theAccounts to {my accountNamed(accountName)}
		else
			set theAccounts to every account
		end if
	end tell
	set theFolders to {}
	repeat with i from 1 to count of theAccounts
		set theFolders to theFolders & my allFolders(item i of theAccounts)
	end repeat
	return theFolders
end searchedFolders

on noteLine(theNote, thePath, accountName)
	tell application id "com.apple.Notes"
		return (id of theNote) & US & (name of theNote) & US & thePath & US & accountName & US & my iso(modification date of theNote) & US & ((password protected of theNote) as text)
	end tell
end noteLine

on accountOf(theFolder)
	tell application id "com.apple.Notes"
		set theContainer to container of theFolder
		repeat while class of theContainer is folder
			set theContainer to container of theContainer
		end repeat
		return name of theContainer
	end tell
end accountOf

on noteWithId(theId)
	tell application id "com.apple.Notes"
		try
			set theNote to note id theId
			set theName to name of theNote
		on error errorText number errorNumber
			if errorNumber is -1728 or errorNumber is -1719 or errorNumber is -1700 then error number 9013
			error errorText number errorNumber
		end try
		if password protected of theNote then error number 9014
		return theNote
	end tell
end noteWithId
`;

/** Notes' scripts, by what each does. */
export const NOTES_SCRIPTS = {
  append: `${NOTES_HELPERS}
on run argv
	set theNote to my noteWithId(item 1 of argv)
	tell application id "com.apple.Notes"
		if (count of attachments of theNote) > 0 then error number 9015
		set body of theNote to (body of theNote) & (item 2 of argv)
		return (id of theNote) & US & (name of theNote)
	end tell
end run
`,
  create: `${NOTES_HELPERS}
on run argv
	set theAccount to my accountNamed(item 1 of argv)
	tell application id "com.apple.Notes"
		if (item 2 of argv) is "" then
			set theFolder to default folder of theAccount
		else
			set theFolder to my folderAt(theAccount, item 2 of argv)
		end if
		set theNote to make new note at theFolder with properties {body:(item 3 of argv)}
		return (id of theNote) & US & (name of theNote) & US & my folderPath(theFolder) & US & (name of theAccount)
	end tell
end run
`,
  folders: `${NOTES_HELPERS}
on run argv
	tell application id "com.apple.Notes"
		if (item 1 of argv) is not "" then
			set theAccounts to {my accountNamed(item 1 of argv)}
		else
			set theAccounts to every account
		end if
	end tell
	set out to {}
	repeat with i from 1 to count of theAccounts
		set theAccount to item i of theAccounts
		tell application id "com.apple.Notes" to set accountName to name of theAccount
		set theFolders to my allFolders(theAccount)
		repeat with k from 1 to count of theFolders
			set theFolder to item k of theFolders
			tell application id "com.apple.Notes" to set noteCount to count of notes of theFolder
			set end of out to accountName & US & my folderPath(theFolder) & US & (noteCount as text)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
  list: `${NOTES_HELPERS}
on run argv
	set theFolders to my searchedFolders(item 1 of argv, item 2 of argv)
	set out to {}
	repeat with i from 1 to count of theFolders
		set theFolder to item i of theFolders
		set thePath to my folderPath(theFolder)
		set accountName to my accountOf(theFolder)
		tell application id "com.apple.Notes"
			set theIds to id of every note of theFolder
			set theNames to name of every note of theFolder
			set theDates to modification date of every note of theFolder
			set theLocks to password protected of every note of theFolder
		end tell
		repeat with k from 1 to count of theIds
			set end of out to (item k of theIds) & US & (item k of theNames) & US & thePath & US & accountName & US & my iso(item k of theDates) & US & ((item k of theLocks) as text)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
  read: `${NOTES_HELPERS}
on run argv
	set theNote to my noteWithId(item 1 of argv)
	tell application id "com.apple.Notes"
		set theFolder to container of theNote
		set theText to my str(plaintext of theNote)
		set theLine to my noteLine(theNote, my folderPath(theFolder), my accountOf(theFolder))
	end tell
	return theLine & US & theText
end run
`,
  search: `${NOTES_HELPERS}
on run argv
	set theQuery to item 1 of argv
	set theLimit to (item 4 of argv) as integer
	set theFolders to my searchedFolders(item 2 of argv, item 3 of argv)
	set out to {}
	repeat with i from 1 to count of theFolders
		set theFolder to item i of theFolders
		set thePath to my folderPath(theFolder)
		set accountName to my accountOf(theFolder)
		tell application id "com.apple.Notes"
			try
				set found to (every note of theFolder whose name contains theQuery or plaintext contains theQuery)
			on error
				set found to {}
			end try
		end tell
		repeat with k from 1 to count of found
			if k > theLimit then exit repeat
			set end of out to my noteLine(item k of found, thePath, accountName)
		end repeat
	end repeat
	return my joined(out, RS)
end run
`,
} as const;

/** Messages' script. */
export const MESSAGES_SCRIPTS = {
  send: `${SCRIPT_HELPERS}
on run argv
	set theHandle to item 1 of argv
	set useSms to (item 2 of argv) is "sms"
	set theText to item 3 of argv
	tell application id "com.apple.MobileSMS"
		try
			if useSms then
				set theAccount to first account whose service type is SMS
			else
				set theAccount to first account whose service type is iMessage
			end if
		on error errorText number errorNumber
			if errorNumber is -1728 or errorNumber is -1719 then error number 9021
			error errorText number errorNumber
		end try
		if not (enabled of theAccount) then error number 9021
		send theText to participant theHandle of theAccount
	end tell
	return ""
end run
`,
} as const;
