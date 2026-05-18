import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

// ── Typed imports after mocking ────────────────────────────────────────────

import { signIn as signInAction, signUp as signUpAction } from "@/actions";
import { getAnonWorkData, clearAnonWork } from "@/lib/anon-work-tracker";
import { getProjects } from "@/actions/get-projects";
import { createProject } from "@/actions/create-project";

const mockSignIn = vi.mocked(signInAction);
const mockSignUp = vi.mocked(signUpAction);
const mockGetAnonWorkData = vi.mocked(getAnonWorkData);
const mockClearAnonWork = vi.mocked(clearAnonWork);
const mockGetProjects = vi.mocked(getProjects);
const mockCreateProject = vi.mocked(createProject);

// ── Helpers ────────────────────────────────────────────────────────────────

const anonWork = {
  messages: [{ role: "user", content: "hello" }],
  fileSystemData: { "/App.jsx": { type: "file", content: "export default () => <div/>" } },
};

const projectStub = { id: "proj-1", name: "Test", createdAt: new Date(), updatedAt: new Date(), userId: "u1", messages: "[]", data: "{}" };

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────

  test("exposes signIn, signUp, and isLoading=false by default", () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.signIn).toBe("function");
    expect(typeof result.current.signUp).toBe("function");
  });

  // ── signIn – happy paths ───────────────────────────────────────────────

  describe("signIn", () => {
    test("with anon work: creates project from anon data, clears storage, and redirects", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(anonWork);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "proj-anon" } as any);

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signIn("a@b.com", "password123");
      });

      expect(mockSignIn).toHaveBeenCalledWith("a@b.com", "password123");
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: anonWork.messages,
          data: anonWork.fileSystemData,
        })
      );
      expect(mockClearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/proj-anon");
      expect(mockGetProjects).not.toHaveBeenCalled();
      expect(returnValue).toEqual({ success: true });
    });

    test("without anon work, existing projects: redirects to most recent project", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([
        { ...projectStub, id: "proj-recent" },
        { ...projectStub, id: "proj-older" },
      ] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(mockGetProjects).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/proj-recent");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("without anon work, no projects: creates a new project and redirects", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "proj-new" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [], data: {} })
      );
      expect(mockPush).toHaveBeenCalledWith("/proj-new");
    });

    // ── signIn – error states ──────────────────────────────────────────

    test("failed sign-in: returns error result without navigating", async () => {
      mockSignIn.mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signIn("a@b.com", "wrong");
      });

      expect(returnValue).toEqual({ success: false, error: "Invalid credentials" });
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockGetProjects).not.toHaveBeenCalled();
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("signIn action throws: propagates the error", async () => {
      mockSignIn.mockRejectedValue(new Error("Network failure"));

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.signIn("a@b.com", "password123");
        })
      ).rejects.toThrow("Network failure");
    });

    // ── isLoading state ────────────────────────────────────────────────

    test("sets isLoading=true during signIn and resets to false afterwards", async () => {
      let resolveSignIn!: (v: any) => void;
      mockSignIn.mockReturnValue(new Promise((res) => (resolveSignIn = res)));
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([{ ...projectStub, id: "p1" }] as any);

      const { result } = renderHook(() => useAuth());

      // Start sign-in but don't await yet
      let signInPromise: Promise<any>;
      act(() => {
        signInPromise = result.current.signIn("a@b.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignIn({ success: true });
        await signInPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("resets isLoading to false even when signIn fails", async () => {
      mockSignIn.mockResolvedValue({ success: false, error: "Bad creds" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "bad");
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("resets isLoading to false even when signIn throws", async () => {
      mockSignIn.mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  // ── signUp – happy paths ───────────────────────────────────────────────

  describe("signUp", () => {
    test("with anon work: creates project from anon data, clears storage, and redirects", async () => {
      mockSignUp.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(anonWork);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "proj-anon" } as any);

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signUp("new@user.com", "password123");
      });

      expect(mockSignUp).toHaveBeenCalledWith("new@user.com", "password123");
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: anonWork.messages,
          data: anonWork.fileSystemData,
        })
      );
      expect(mockClearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/proj-anon");
      expect(returnValue).toEqual({ success: true });
    });

    test("without anon work, existing projects: redirects to most recent project", async () => {
      mockSignUp.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([{ ...projectStub, id: "proj-1" }] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@user.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/proj-1");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("without anon work, no projects: creates a new project and redirects", async () => {
      mockSignUp.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "proj-fresh" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@user.com", "password123");
      });

      expect(mockPush).toHaveBeenCalledWith("/proj-fresh");
    });

    // ── signUp – error states ──────────────────────────────────────────

    test("failed sign-up: returns error result without navigating", async () => {
      mockSignUp.mockResolvedValue({ success: false, error: "Email already registered" });

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signUp("taken@email.com", "password123");
      });

      expect(returnValue).toEqual({ success: false, error: "Email already registered" });
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("signUp action throws: propagates the error", async () => {
      mockSignUp.mockRejectedValue(new Error("Server error"));

      const { result } = renderHook(() => useAuth());

      await expect(
        act(async () => {
          await result.current.signUp("a@b.com", "password123");
        })
      ).rejects.toThrow("Server error");
    });

    test("sets isLoading=true during signUp and resets to false afterwards", async () => {
      let resolveSignUp!: (v: any) => void;
      mockSignUp.mockReturnValue(new Promise((res) => (resolveSignUp = res)));
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([{ ...projectStub, id: "p1" }] as any);

      const { result } = renderHook(() => useAuth());

      let signUpPromise: Promise<any>;
      act(() => {
        signUpPromise = result.current.signUp("a@b.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignUp({ success: true });
        await signUpPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("resets isLoading to false even when signUp throws", async () => {
      mockSignUp.mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("a@b.com", "password123").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("anon work with empty messages array: skips project creation and falls through to getProjects", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
      mockGetProjects.mockResolvedValue([{ ...projectStub, id: "proj-existing" }] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      // messages.length === 0 → should NOT create project from anon work
      expect(mockClearAnonWork).not.toHaveBeenCalled();
      expect(mockGetProjects).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/proj-existing");
    });

    test("createProject name for new project includes a numeric suffix", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(null);
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "p-new" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      const callArg = mockCreateProject.mock.calls[0][0];
      expect(callArg.name).toMatch(/^New Design #\d+$/);
    });

    test("createProject name for anon-work project includes a time string", async () => {
      mockSignIn.mockResolvedValue({ success: true });
      mockGetAnonWorkData.mockReturnValue(anonWork);
      mockCreateProject.mockResolvedValue({ ...projectStub, id: "p-anon" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("a@b.com", "password123");
      });

      const callArg = mockCreateProject.mock.calls[0][0];
      expect(callArg.name).toMatch(/^Design from .+$/);
    });
  });
});
