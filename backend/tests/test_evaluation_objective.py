"""客观题服务端判分与诊断题库数据完整性测试（T1/T2 配套）"""
import pytest

from seed_data import seed_all_data  # noqa: F401  确认种子模块可导入（含 seed_diagnostic 接线）
from seed_diagnostic import DIAGNOSTIC_QUESTIONS
from services.evaluation_service import evaluation_service


class TestObjectiveEvaluation:
    """evaluate_objective_submission — 与前端 exercise-renderer 判分规则一致"""

    def test_quiz_delegates_to_program_scoring(self):
        test_cases = {"questions": [
            {"id": "1", "answer": 2, "explanation": ""},
            {"id": "2", "answer": 0, "explanation": ""},
        ]}
        result = evaluation_service.evaluate_objective_submission(
            "quiz", test_cases, {"1": 2, "2": 1}
        )
        assert result["score"] == 50
        assert result["status"] == "failed"

    def test_judge_uses_quiz_rules(self):
        test_cases = {"questions": [{"id": "1", "answer": 1}]}
        result = evaluation_service.evaluate_objective_submission(
            "judge", test_cases, {"1": 1}
        )
        assert result["score"] == 100
        assert result["status"] == "passed"

    def test_match_requires_full_correct(self):
        test_cases = {"pairs": {"列表": "可变序列", "元组": "不可变序列"}}
        partial = evaluation_service.evaluate_objective_submission(
            "match", test_cases, {"matches": {"列表": "可变序列", "元组": "可变序列"}}
        )
        assert partial["score"] == 50
        assert partial["status"] == "failed"

        full = evaluation_service.evaluate_objective_submission(
            "match", test_cases,
            {"matches": {"列表": "可变序列", "元组": "不可变序列"}},
        )
        assert full["score"] == 100
        assert full["status"] == "passed"

    def test_arrange_exact_order_only(self):
        test_cases = {"correct_order": [2, 0, 1]}
        wrong = evaluation_service.evaluate_objective_submission(
            "arrange", test_cases, {"order": [0, 1, 2]}
        )
        assert wrong["score"] == 0
        assert wrong["status"] == "failed"

        right = evaluation_service.evaluate_objective_submission(
            "arrange", test_cases, {"order": [2, 0, 1]}
        )
        assert right["score"] == 100
        assert right["status"] == "passed"

    def test_arrange_length_mismatch_fails(self):
        test_cases = {"correct_order": [0, 1, 2]}
        result = evaluation_service.evaluate_objective_submission(
            "arrange", test_cases, {"order": [0, 1]}
        )
        assert result["status"] == "failed"

    def test_fill_trims_and_ignores_case(self):
        test_cases = {"blanks": ["Yield", "generator"]}
        result = evaluation_service.evaluate_objective_submission(
            "fill", test_cases, {"blanks": ["  yield ", "GENERATOR"]}
        )
        assert result["score"] == 100
        assert result["status"] == "passed"

    def test_fill_partial_answers(self):
        test_cases = {"blanks": ["a", "b"]}
        result = evaluation_service.evaluate_objective_submission(
            "fill", test_cases, {"blanks": ["a"]}
        )
        assert result["score"] == 50
        assert result["status"] == "failed"

    def test_missing_data_returns_error(self):
        for lab_type in ("match", "arrange", "fill"):
            result = evaluation_service.evaluate_objective_submission(lab_type, {}, {})
            assert result["status"] == "error"

    def test_unknown_type_returns_error(self):
        result = evaluation_service.evaluate_objective_submission("essay", {}, {})
        assert result["status"] == "error"


class TestDiagnosticBank:
    """诊断题库数据完整性 — 防止题库损坏导致 Onboarding 失真"""

    def test_each_domain_has_ten_questions(self):
        assert set(DIAGNOSTIC_QUESTIONS.keys()) == {
            "programming", "dsa", "organization", "os", "network", "database",
        }
        for domain, questions in DIAGNOSTIC_QUESTIONS.items():
            assert len(questions) == 10, f"领域 {domain} 应有 10 题"

    @pytest.mark.parametrize("domain", list(DIAGNOSTIC_QUESTIONS.keys()))
    def test_question_structure_valid(self, domain):
        for q in DIAGNOSTIC_QUESTIONS[domain]:
            assert q["question"].strip()
            assert len(q["options"]) == 4, f"{q['title']} 应有 4 个选项"
            assert 0 <= q["answer"] < 4, f"{q['title']} 答案下标越界"
            assert q["explanation"].strip(), f"{q['title']} 缺少解析"
            assert q["code"].startswith("PY_"), f"{q['title']} 节点码异常"

    def test_node_codes_exist_in_seed(self):
        """题目绑定的节点码必须在种子图谱中真实存在"""
        import inspect

        import seed_data

        source = inspect.getsource(seed_data)
        for domain, questions in DIAGNOSTIC_QUESTIONS.items():
            for q in questions:
                assert f'"{q["code"]}"' in source, (
                    f"诊断题 {q['title']} 绑定的节点码 {q['code']} 不在 seed_data 中"
                )
