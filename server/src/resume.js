// Sample résumé profile used as the default for ATS matching when no résumé has
// been uploaded (upload your own in the ATS tab for accurate scoring). Contains
// no personal data. `text` is fed through the same skill extractor used on jobs
// so the résumé's skills and a job's skills match on a consistent vocabulary.

export const RESUME = {
  name: "Sample Candidate",
  headline: "Software Engineer",
  years: 3,
  targetTitles: [
    "software engineer",
    "software development engineer",
    "sde",
    "backend engineer",
    "back end engineer",
    "full stack",
    "member of technical staff",
    "computer scientist",
    "platform engineer",
    "security engineer",
    "distributed systems",
  ],
  text: `
    Software engineer with backend and distributed-systems experience across
    microservices and cloud platforms.
    Languages: C C++ Java Python C# Go Golang.
    Web: HTML CSS JavaScript Django MySQL SQL REST API RESTful Angular NoSQL.
    Tools: Windows Linux Jenkins CI CD Spring Boot Maven Git Splunk Postman ADO Azure DevOps.
    NLP natural language processing, Apache Kafka, Apache Spark, Docker, Kubernetes K8s,
    AWS Lambda, AWS, Azure, public cloud, Agentic AI, MCP server, Kusto, kubectl, Helm.
    Kubernetes onboarding platform, security posture, observability networking identity
    autoscaling, IaaS monitoring cloud security auto-remediation policy compliance,
    test-driven development TDD distributed deployment, scalable low latency web services,
    system design algorithms data structures.
  `,
};
