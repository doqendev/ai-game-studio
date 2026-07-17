using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class JobSupervisor
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const uint INFINITE = 0xFFFFFFFF;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob,
        int jobObjectInfoClass,
        IntPtr lpJobObjectInfo,
        uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr hJob,
        int jobObjectInfoClass,
        IntPtr lpJobObjectInfo,
        uint cbJobObjectInfoLength,
        IntPtr lpReturnLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    private sealed class Options
    {
        public uint OwnerPid;
        public ulong MemoryMiB;
        public uint TimeoutMs;
        public string WorkingDirectory;
        public readonly List<string> Command = new List<string>();
    }

    public static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr owner = IntPtr.Zero;
        PROCESS_INFORMATION child = new PROCESS_INFORMATION();
        string reason = "launcher-error";
        try
        {
            Options options = Parse(args);
            job = CreateJobObject(IntPtr.Zero, null);
            CheckHandle(job, "CreateJobObject");
            ConfigureJob(job, options.MemoryMiB);

            if (options.OwnerPid != 0)
            {
                owner = OpenProcess(SYNCHRONIZE, false, options.OwnerPid);
                CheckHandle(owner, "OpenProcess(owner)");
            }

            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);

            StringBuilder commandLine = new StringBuilder(BuildCommandLine(options.Command));
            bool created = CreateProcess(
                null,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                IntPtr.Zero,
                options.WorkingDirectory,
                ref startup,
                out child);
            if (!created) ThrowWin32("CreateProcess");
            if (!AssignProcessToJobObject(job, child.hProcess)) ThrowWin32("AssignProcessToJobObject");
            if (ResumeThread(child.hThread) == 0xFFFFFFFF) ThrowWin32("ResumeThread");
            CloseHandle(child.hThread);
            child.hThread = IntPtr.Zero;

            Diagnostic("started", "pid=" + child.dwProcessId + " ownerPid=" + options.OwnerPid + " memoryMiB=" + options.MemoryMiB + " timeoutMs=" + options.TimeoutMs);
            Stopwatch elapsed = Stopwatch.StartNew();
            ulong declaredMemoryLimitBytes = options.MemoryMiB * 1024UL * 1024UL;

            while (true)
            {
                uint childWait = WaitForSingleObject(child.hProcess, 100);
                if (childWait == WAIT_OBJECT_0)
                {
                    reason = "child-exit";
                    uint exitCode;
                    if (!GetExitCodeProcess(child.hProcess, out exitCode)) ThrowWin32("GetExitCodeProcess");
                    Diagnostic("completed", "reason=" + reason + " childExitCode=" + exitCode + " peakJobBytes=" + QueryPeakJobBytes(job));
                    return unchecked((int)exitCode);
                }
                if (childWait != WAIT_TIMEOUT) ThrowWin32("WaitForSingleObject(child)");

                if (owner != IntPtr.Zero && WaitForSingleObject(owner, 0) == WAIT_OBJECT_0)
                {
                    reason = "owner-exit";
                    TerminateJobObject(job, 125);
                    Diagnostic("terminated", "reason=" + reason + " peakJobBytes=" + QueryPeakJobBytes(job));
                    return 125;
                }

                if (options.TimeoutMs != 0 && elapsed.ElapsedMilliseconds >= options.TimeoutMs)
                {
                    reason = "timeout";
                    TerminateJobObject(job, 124);
                    Diagnostic("terminated", "reason=" + reason + " peakJobBytes=" + QueryPeakJobBytes(job));
                    return 124;
                }

                if (declaredMemoryLimitBytes != 0)
                {
                    ulong peakJobBytes = QueryPeakJobBytes(job);
                    ulong highWaterBytes = declaredMemoryLimitBytes / 100UL * 80UL;
                    if (peakJobBytes >= highWaterBytes)
                    {
                        reason = "memory-high-water";
                        TerminateJobObject(job, 123);
                        Diagnostic("terminated", "reason=" + reason + " peakJobBytes=" + peakJobBytes + " highWaterBytes=" + highWaterBytes + " osHardLimitBytes=" + EffectiveHardMemoryLimit(declaredMemoryLimitBytes) + " declaredLimitBytes=" + declaredMemoryLimitBytes);
                        return 123;
                    }
                }
            }
        }
        catch (Exception error)
        {
            Diagnostic("failed", "reason=" + reason + " error=" + Sanitize(error.Message));
            if (job != IntPtr.Zero) TerminateJobObject(job, 126);
            return 126;
        }
        finally
        {
            if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
            if (child.hProcess != IntPtr.Zero) CloseHandle(child.hProcess);
            if (owner != IntPtr.Zero) CloseHandle(owner);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    private static Options Parse(string[] args)
    {
        Options result = new Options();
        int index = 0;
        while (index < args.Length)
        {
            if (args[index] == "--")
            {
                index++;
                while (index < args.Length) result.Command.Add(args[index++]);
                break;
            }
            if (args[index] == "--owner-pid" && index + 1 < args.Length)
            {
                result.OwnerPid = UInt32.Parse(args[index + 1]);
                index += 2;
                continue;
            }
            if (args[index] == "--memory-mib" && index + 1 < args.Length)
            {
                result.MemoryMiB = UInt64.Parse(args[index + 1]);
                index += 2;
                continue;
            }
            if (args[index] == "--timeout-ms" && index + 1 < args.Length)
            {
                result.TimeoutMs = UInt32.Parse(args[index + 1]);
                index += 2;
                continue;
            }
            if (args[index] == "--working-directory" && index + 1 < args.Length)
            {
                result.WorkingDirectory = args[index + 1];
                index += 2;
                continue;
            }
            throw new ArgumentException("Unknown or incomplete option: " + args[index]);
        }
        if (result.Command.Count == 0) throw new ArgumentException("A command is required after --");
        return result;
    }

    private static void ConfigureJob(IntPtr job, ulong memoryMiB)
    {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (memoryMiB != 0)
        {
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
            ulong declaredBytes = checked(memoryMiB * 1024UL * 1024UL);
            limits.JobMemoryLimit = new UIntPtr(EffectiveHardMemoryLimit(declaredBytes));
        }

        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)size))
                ThrowWin32("SetInformationJobObject");
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static ulong EffectiveHardMemoryLimit(ulong declaredBytes)
    {
        return declaredBytes / 100UL * 90UL;
    }

    private static ulong QueryPeakJobBytes(IntPtr job)
    {
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)size, IntPtr.Zero))
                return 0;
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION value = (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)Marshal.PtrToStructure(pointer, typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            return value.PeakJobMemoryUsed.ToUInt64();
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static string BuildCommandLine(List<string> command)
    {
        List<string> quoted = new List<string>();
        foreach (string item in command) quoted.Add(QuoteArgument(item));
        return string.Join(" ", quoted.ToArray());
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length != 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        StringBuilder result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static void CheckHandle(IntPtr handle, string operation)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) ThrowWin32(operation);
    }

    private static void ThrowWin32(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static void Diagnostic(string action, string detail)
    {
        Console.Error.WriteLine("GATE0_JOB action=" + action + " " + detail);
        Console.Error.Flush();
    }

    private static string Sanitize(string value)
    {
        return value.Replace('\r', ' ').Replace('\n', ' ');
    }
}
