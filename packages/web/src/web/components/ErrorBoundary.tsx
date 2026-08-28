import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

/**
 * Empêche qu'une erreur de rendu React fasse disparaître toute l'app (la
 * fameuse « page grise » vide). Au lieu de démonter tout l'arbre, on affiche
 * un écran de secours avec un bouton pour recharger.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
	}

	handleReload = () => {
		this.setState({ hasError: false, error: undefined });
		window.location.reload();
	};

	render() {
		if (this.state.hasError) {
			return (
				<div
					style={{
						minHeight: "100vh",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						gap: "16px",
						padding: "24px",
						textAlign: "center",
						background: "var(--bg, #0f0f11)",
						color: "var(--text, #f5f5f5)",
						fontFamily: "system-ui, -apple-system, sans-serif",
					}}
				>
					<div style={{ fontSize: "40px" }}>⚠️</div>
					<h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
						An error occurred
					</h1>
					<p style={{ fontSize: "14px", opacity: 0.7, maxWidth: "420px", margin: 0 }}>
						The display ran into an unexpected problem. Your data is
						saved — reload the page to continue.
					</p>
					<button
						onClick={this.handleReload}
						style={{
							marginTop: "8px",
							padding: "10px 20px",
							borderRadius: "10px",
							border: "none",
							background: "var(--accent, #6d5efc)",
							color: "#fff",
							fontSize: "14px",
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						Reload
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
