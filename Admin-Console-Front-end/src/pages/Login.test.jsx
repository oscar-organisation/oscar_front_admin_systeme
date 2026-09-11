import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/shared/design-system/themes";
import { AuthProvider } from "../auth/AuthContext.jsx";
import Login from "./Login.jsx";

describe("Login", () => {
  it("affiche un formulaire de connexion accessible", () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AuthProvider>
            <Login />
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/adresse email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mot de passe/i)).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveTextContent(/se connecter/i);
  });
});
